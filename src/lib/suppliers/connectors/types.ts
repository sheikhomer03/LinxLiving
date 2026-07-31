/**
 * Supplier connector interface — each supplier gets its own adapter.
 * Phase 1: Manual + CSV. Future: REST / XML / FTP / SFTP / EDI.
 */

export type ConnectorType =
  | "manual"
  | "csv"
  | "rest"
  | "xml"
  | "json_feed"
  | "ftp"
  | "sftp"
  | "edi";

export type ConnectorStockRow = {
  supplierSku: string;
  stock: number;
  costPrice?: number | null;
  leadTimeDays?: number | null;
  deliveryCost?: number | null;
};

export type ConnectorSyncResult = {
  success: boolean;
  connector: ConnectorType;
  updated: number;
  skipped: number;
  errors: string[];
  syncedAt: string;
};

export interface SupplierConnector {
  type: ConnectorType;
  /** Pull stock/price from supplier and return normalised rows */
  fetchCatalog?(config: Record<string, unknown>): Promise<ConnectorStockRow[]>;
  /** Submit a purchase order when supplier supports it */
  submitPurchaseOrder?(
    config: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): Promise<{ success: boolean; confirmationRef?: string; error?: string }>;
}

export const CONNECTOR_LABELS: Record<ConnectorType, string> = {
  manual: "Manual upload",
  csv: "CSV / Excel",
  rest: "REST API",
  xml: "XML feed",
  json_feed: "JSON feed",
  ftp: "FTP",
  sftp: "SFTP",
  edi: "EDI",
};
