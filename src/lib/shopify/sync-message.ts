import { shopifyAdminRequest } from "./admin";
import { isShopifySyncEnabled } from "./config";
import connectDB from "@/lib/mongodb";
import { ContactQuery } from "@/models/ContactQuery";
import { revalidatePath } from "next/cache";

const METAOBJECT_TYPE = "linx_contact_inquiry";

let definitionReady: Promise<boolean> | null = null;

async function ensureContactMetaobjectDefinition() {
  if (!definitionReady) {
    definitionReady = (async () => {
      try {
        const existing = await shopifyAdminRequest<{
          metaobjectDefinitionByType: { id: string } | null;
        }>(
          `
          query Def($type: String!) {
            metaobjectDefinitionByType(type: $type) { id }
          }
        `,
          { type: METAOBJECT_TYPE },
        );
        if (existing.metaobjectDefinitionByType?.id) return true;

        const created = await shopifyAdminRequest<{
          metaobjectDefinitionCreate: {
            metaobjectDefinition: { id: string } | null;
            userErrors: { message: string }[];
          };
        }>(
          `
          mutation CreateDef($definition: MetaobjectDefinitionCreateInput!) {
            metaobjectDefinitionCreate(definition: $definition) {
              metaobjectDefinition { id }
              userErrors { message }
            }
          }
        `,
          {
            definition: {
              type: METAOBJECT_TYPE,
              name: "Linx Contact Inquiry",
              fieldDefinitions: [
                {
                  key: "name",
                  name: "Name",
                  type: "single_line_text_field",
                  required: true,
                },
                {
                  key: "email",
                  name: "Email",
                  type: "single_line_text_field",
                  required: true,
                },
                {
                  key: "subject",
                  name: "Subject",
                  type: "single_line_text_field",
                  required: true,
                },
                {
                  key: "message",
                  name: "Message",
                  type: "multi_line_text_field",
                  required: true,
                },
                {
                  key: "status",
                  name: "Status",
                  type: "single_line_text_field",
                  required: false,
                },
              ],
            },
          },
        );
        if (created.metaobjectDefinitionCreate.userErrors.length) {
          console.error(
            "Metaobject definition create errors:",
            created.metaobjectDefinitionCreate.userErrors,
          );
          return false;
        }
        return Boolean(created.metaobjectDefinitionCreate.metaobjectDefinition?.id);
      } catch (error) {
        console.error("ensureContactMetaobjectDefinition failed:", error);
        return false;
      }
    })();
  }
  return definitionReady;
}

function fieldsFromInquiry(input: {
  name: string;
  email: string;
  subject: string;
  message: string;
  status?: string;
}) {
  return [
    { key: "name", value: input.name },
    { key: "email", value: input.email },
    { key: "subject", value: input.subject },
    { key: "message", value: input.message },
    { key: "status", value: input.status || "pending" },
  ];
}

export async function pushInquiryToShopify(input: {
  name: string;
  email: string;
  subject: string;
  message: string;
  status?: string;
  shopifyMetaobjectId?: string | null;
}) {
  if (!isShopifySyncEnabled()) return null;
  const ok = await ensureContactMetaobjectDefinition();
  if (!ok) return null;

  if (input.shopifyMetaobjectId) {
    const data = await shopifyAdminRequest<{
      metaobjectUpdate: {
        metaobject: { id: string } | null;
        userErrors: { message: string }[];
      };
    }>(
      `
      mutation UpdateInquiry($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) {
          metaobject { id }
          userErrors { message }
        }
      }
    `,
      {
        id: input.shopifyMetaobjectId,
        metaobject: { fields: fieldsFromInquiry(input) },
      },
    );
    if (data.metaobjectUpdate.userErrors.length) {
      throw new Error(
        data.metaobjectUpdate.userErrors.map((e) => e.message).join("; "),
      );
    }
    return data.metaobjectUpdate.metaobject?.id ?? input.shopifyMetaobjectId;
  }

  const data = await shopifyAdminRequest<{
    metaobjectCreate: {
      metaobject: { id: string } | null;
      userErrors: { message: string }[];
    };
  }>(
    `
    mutation CreateInquiry($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject { id }
        userErrors { message }
      }
    }
  `,
    {
      metaobject: {
        type: METAOBJECT_TYPE,
        fields: fieldsFromInquiry(input),
      },
    },
  );

  if (data.metaobjectCreate.userErrors.length) {
    throw new Error(
      data.metaobjectCreate.userErrors.map((e) => e.message).join("; "),
    );
  }
  return data.metaobjectCreate.metaobject?.id ?? null;
}

export async function pullInquiriesFromShopify(first = 50) {
  if (!isShopifySyncEnabled()) return { pulled: 0 };

  const ok = await ensureContactMetaobjectDefinition();
  if (!ok) return { pulled: 0 };

  const data = await shopifyAdminRequest<{
    metaobjects: {
      nodes: {
        id: string;
        fields: { key: string; value: string }[];
      }[];
    };
  }>(
    `
    query Inquiries($type: String!, $first: Int!) {
      metaobjects(type: $type, first: $first, reverse: true) {
        nodes {
          id
          fields { key value }
        }
      }
    }
  `,
    { type: METAOBJECT_TYPE, first },
  );

  await connectDB();
  let pulled = 0;
  for (const node of data.metaobjects.nodes) {
    const map = Object.fromEntries(
      (node.fields || []).map((f) => [f.key, f.value]),
    );
    const email = String(map.email || "").toLowerCase().trim();
    const subject = String(map.subject || "").trim();
    const message = String(map.message || "").trim();
    if (!email || !subject || !message) continue;

    const status = ["pending", "replied", "archived"].includes(map.status)
      ? map.status
      : "pending";

    const existing = await ContactQuery.findOne({
      $or: [
        { shopifyMetaobjectId: node.id },
        { email, subject, message },
      ],
    });

    if (existing) {
      existing.name = map.name || existing.name;
      existing.email = email;
      existing.subject = subject;
      existing.message = message;
      existing.status = status;
      existing.shopifyMetaobjectId = node.id;
      existing.shopifySyncedAt = new Date();
      await existing.save();
    } else {
      await ContactQuery.create({
        name: map.name || email,
        email,
        subject,
        message,
        status,
        shopifyMetaobjectId: node.id,
        shopifySyncedAt: new Date(),
      });
    }
    pulled += 1;
  }

  revalidatePath("/admin/queries");
  return { pulled };
}

export async function pushUnsyncedInquiries(limit = 15) {
  if (!isShopifySyncEnabled()) return { pushed: 0 };
  await connectDB();
  const rows = await ContactQuery.find({
    $or: [
      { shopifyMetaobjectId: null },
      { shopifyMetaobjectId: { $exists: false } },
      { shopifyMetaobjectId: "" },
    ],
  })
    .limit(limit)
    .lean();

  let pushed = 0;
  for (const row of rows as any[]) {
    try {
      const id = await pushInquiryToShopify({
        name: row.name,
        email: row.email,
        subject: row.subject,
        message: row.message,
        status: row.status,
      });
      if (id) {
        await ContactQuery.updateOne(
          { _id: row._id },
          {
            $set: {
              shopifyMetaobjectId: id,
              shopifySyncedAt: new Date(),
            },
          },
        );
        pushed += 1;
      }
    } catch (error) {
      console.error("Inquiry catch-up sync failed:", error);
    }
  }
  return { pushed };
}
