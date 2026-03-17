import CategoryPage from "@/components/layout/CategoryTemplate";
import { getMenuBySlug } from "@/app/actions/admin";
import { Metadata } from "next";
import { notFound } from "next/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const menu = await getMenuBySlug(slug);
  if (!menu) return { title: "Category Not Found" };

  return {
    title: `${menu.name} | Linx Living`,
    description: `Explore our collection of ${menu.name}. Premium architectural materials and luxury surfaces for refined living.`,
    alternates: {
      canonical: `/category/${slug}`,
    },
  };
}

export default async function DynamicCategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const menu = await getMenuBySlug(slug);

  if (!menu) {
    notFound();
  }

  return (
    <CategoryPage
      title={menu.name}
      description={`Discover our exclusive range of ${menu.name}, curated for luxury architectural projects.`}
      slug={menu.slug}
    />
  );
}
