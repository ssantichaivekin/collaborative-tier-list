/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai from "../ai.js";
import type * as catalog from "../catalog.js";
import type * as firecrawl from "../firecrawl.js";
import type * as gateway from "../gateway.js";
import type * as imageCache from "../imageCache.js";
import type * as imageChoices from "../imageChoices.js";
import type * as imageProgress from "../imageProgress.js";
import type * as imageSearch from "../imageSearch.js";
import type * as imageSelection from "../imageSelection.js";
import type * as lib_remoteImage from "../lib/remoteImage.js";
import type * as presence from "../presence.js";
import type * as rooms from "../rooms.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  catalog: typeof catalog;
  firecrawl: typeof firecrawl;
  gateway: typeof gateway;
  imageCache: typeof imageCache;
  imageChoices: typeof imageChoices;
  imageProgress: typeof imageProgress;
  imageSearch: typeof imageSearch;
  imageSelection: typeof imageSelection;
  "lib/remoteImage": typeof lib_remoteImage;
  presence: typeof presence;
  rooms: typeof rooms;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
