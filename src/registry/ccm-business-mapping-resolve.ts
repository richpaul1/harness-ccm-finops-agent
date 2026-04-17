import type { HarnessClient } from "../client/harness-client.js";
import { ccmBusinessMappingListExtract } from "./extractors.js";
import { isRecord } from "../utils/type-guards.js";

export interface ResolvedBusinessMapping {
  /** Same as cost category `uuid` — used as GraphQL `entityGroupBy.fieldId`. */
  fieldId: string;
  /** Display name for GraphQL `entityGroupBy.fieldName` (e.g. Business Domains). */
  fieldName: string;
}

/**
 * Resolve a cost category by name via the same list API as `harness_list cost_category`.
 * The mapping's **uuid** is the GraphQL group-by field id for BUSINESS_MAPPING dimensions.
 */
export async function resolveBusinessMappingForGroupBy(
  client: HarnessClient,
  accountId: string,
  mappingName: string,
  signal?: AbortSignal,
): Promise<ResolvedBusinessMapping> {
  const searchKey = mappingName.trim();
  if (!searchKey) {
    throw new Error("business_mapping_name is empty");
  }

  const raw = await client.request<unknown>({
    method: "GET",
    path: "/ccm/api/business-mapping",
    params: {
      searchKey,
      limit: 50,
      offset: 0,
      sortOrder: "ASCENDING",
      sortType: "NAME",
      routingId: accountId,
    },
    signal,
  });

  const { items } = ccmBusinessMappingListExtract(raw);
  const target = searchKey.toLowerCase();
  const match = items.find((item) => {
    if (!isRecord(item)) return false;
    const n = item.name;
    return typeof n === "string" && n.toLowerCase() === target;
  });

  if (!match || !isRecord(match) || typeof match.uuid !== "string") {
    throw new Error(
      `No cost category named "${searchKey}". ` +
        `Use harness_list resource_type=cost_category to list names, then set filters.business_mapping_name or pass business_mapping_field_id (uuid).`,
    );
  }

  return {
    fieldId: match.uuid,
    fieldName: typeof match.name === "string" ? match.name : searchKey,
  };
}
