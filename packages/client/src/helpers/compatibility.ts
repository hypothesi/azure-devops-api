import { apiVersions, clientVersion, products, specSnapshot } from '../generated/compatibility';

/** An API version that this client version supports, such as `'7.1'`. */
export type ApiVersion = keyof typeof apiVersions;

/** An Azure DevOps product, such as `'services'` or `'server-2022'`. */
export type ProductID = keyof typeof products;

/** A subpath export of the package: an API version or a product. */
export type EntryPointID = ApiVersion | ProductID;

export interface ApiVersionInfo {
   /** For code, for example `'7.0'`. */
   readonly id: ApiVersion;
   /** For UI text, for example `'Azure DevOps REST API 7.0'`. */
   readonly label: string;
   /** Every product that accepts this API version. */
   readonly products: readonly ProductID[];
   /** The import path of the entry point for this API version. */
   readonly importPath: string;
}

export interface ProductInfo {
   /** For code, for example `'server-2022'`. */
   readonly id: ProductID;
   /** For UI text, for example `'Azure DevOps Server 2022'`. */
   readonly label: string;
   /** The highest API version the product accepts. It also accepts every lower version. */
   readonly highestApiVersion: ApiVersion;
   /** Where `highestApiVersion` comes from. */
   readonly source: string;
   /** ISO date of a test against a real instance, or `null` when nobody has tested it. */
   readonly verifiedOn: string | null;
   /** The import path of the entry point for this product. */
   readonly importPath: string;
}

export interface EntryPointInfo {
   /** For code, for example `'server-2022'`. */
   readonly id: EntryPointID;
   /** For UI text, for example `'Azure DevOps Server 2022 (REST API 7.0)'`. */
   readonly label: string;
   /** For example `'@hypothesi/azure-devops-api/server-2022'`. */
   readonly importPath: string;
   /** The API version that every call from this entry point sends. */
   readonly apiVersion: ApiVersion;
   /** Every product this entry point works with. */
   readonly products: readonly ProductID[];
}

export interface Compatibility {
   /** The version of `@hypothesi/azure-devops-api`, for example `'1.2.0'`. */
   readonly clientVersion: string;
   /** The Software Heritage ID of the Microsoft spec folder the client was generated from. */
   readonly specSnapshot: string;
   /** Lowest first. */
   readonly apiVersions: readonly ApiVersionInfo[];
   readonly products: readonly ProductInfo[];
   /** API version entry points first, then product entry points. */
   readonly entryPoints: readonly EntryPointInfo[];
}

const PACKAGE_NAME = '@hypothesi/azure-devops-api';

/** Every API version this client version supports, lowest first. */
export const SUPPORTED_API_VERSIONS: readonly ApiVersion[] = Object.freeze(
   Object.keys(apiVersions).filter(isSupportedApiVersion).toSorted(compareApiVersions),
);

/** Checks whether this client version supports `value`, for example a version read from settings. */
export function isSupportedApiVersion(value: string): value is ApiVersion {
   return Object.hasOwn(apiVersions, value);
}

/** Checks whether `value` is a product this client version knows. */
export function isProductID(value: string): value is ProductID {
   return Object.hasOwn(products, value);
}

/**
 * Describes what this client version supports, with an `id` for code and a `label` for UI
 * text on every item.
 *
 * @example
 * ```ts
 * import { getCompatibility } from '@hypothesi/azure-devops-api'
 *
 * const { clientVersion, apiVersions } = getCompatibility()
 *
 * console.log(`Client ${clientVersion} supports ${apiVersions.map((version) => version.label).join(', ')}`)
 * ```
 */
export function getCompatibility(): Compatibility {
   return COMPATIBILITY;
}

/** Returns the entry point for an API version or a product, for example `getEntryPoint('server-2022')`. */
export function getEntryPoint(id: EntryPointID): EntryPointInfo {
   const entryPoint = COMPATIBILITY.entryPoints.find((candidate) => {
      return candidate.id === id;
   });

   if (!entryPoint) {
      throw new RangeError(`${PACKAGE_NAME} has no entry point named ${id}`);
   }

   return entryPoint;
}

function compareApiVersions(a: string, b: string): number {
   return a.localeCompare(b, 'en', { numeric: true });
}

function getApiVersionLabel(apiVersion: ApiVersion): string {
   return `Azure DevOps REST API ${apiVersion}`;
}

function toApiVersion(value: string): ApiVersion {
   if (!isSupportedApiVersion(value)) {
      throw new RangeError(`The manifest lists a product whose highest API version ${value} is not supported`);
   }

   return value;
}

function listProductsFor(apiVersion: ApiVersion): ProductID[] {
   return apiVersions[apiVersion].products.filter(isProductID);
}

function buildProducts(): ProductInfo[] {
   return Object.keys(products)
      .filter(isProductID)
      .map((id): ProductInfo => {
         const product = products[id];

         return {
            id,
            label: product.name,
            highestApiVersion: toApiVersion(product.highestApiVersion),
            source: product.source,
            verifiedOn: product.verifiedOn,
            importPath: `${PACKAGE_NAME}/${id}`,
         };
      });
}

function buildEntryPoints(productList: readonly ProductInfo[]): EntryPointInfo[] {
   const versionEntries = SUPPORTED_API_VERSIONS.map((apiVersion): EntryPointInfo => {
         return {
            id: apiVersion,
            label: getApiVersionLabel(apiVersion),
            importPath: `${PACKAGE_NAME}/${apiVersion}`,
            apiVersion,
            products: listProductsFor(apiVersion),
         };
      }),
      productEntries = productList.map((product): EntryPointInfo => {
         return {
            id: product.id,
            label: `${product.label} (REST API ${product.highestApiVersion})`,
            importPath: product.importPath,
            apiVersion: product.highestApiVersion,
            products: listProductsFor(product.highestApiVersion),
         };
      });

   return [...versionEntries, ...productEntries];
}

function buildCompatibility(): Compatibility {
   const productList = buildProducts();

   return Object.freeze({
      clientVersion,
      specSnapshot,
      apiVersions: SUPPORTED_API_VERSIONS.map((id): ApiVersionInfo => {
         return {
            id,
            label: getApiVersionLabel(id),
            products: listProductsFor(id),
            importPath: `${PACKAGE_NAME}/${id}`,
         };
      }),
      products: productList,
      entryPoints: buildEntryPoints(productList),
   });
}

const COMPATIBILITY = buildCompatibility();
