import type { ConnectorStockRow, SupplierConnector } from "./types";

/**
 * CSV connector — rows are applied via admin CSV upload today.
 * Future: pull from feedUrl / FTP into the same row shape.
 */
export const csvConnector: SupplierConnector = {
  type: "csv",
  async fetchCatalog() {
    // Admin FormData import path handles file bytes; remote feed pull TBD.
    return [] as ConnectorStockRow[];
  },
};
