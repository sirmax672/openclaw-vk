import type { NormalizedLocation } from "openclaw/plugin-sdk/channel-inbound";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** VK's string form is longitude latitude; object fields are named explicitly. */
export function parseVkLocation(value: unknown): NormalizedLocation | undefined {
  const geo = record(value);
  if (!geo) return;
  const coords = geo.coordinates;
  let latitude: unknown;
  let longitude: unknown;
  if (typeof coords === "string") {
    const number = "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)";
    const match = coords.trim().match(new RegExp(`^(${number})\\s+(${number})$`));
    if (!match) return;
    longitude = Number(match[1]); latitude = Number(match[2]);
  } else {
    const obj = record(coords);
    latitude = obj?.latitude; longitude = obj?.longitude;
  }
  if (typeof latitude !== "number" || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
      typeof longitude !== "number" || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return;
  const place = record(geo.place);
  const text = (v: unknown) => typeof v === "string" && v.trim() ? v.trim().slice(0, 1000) : undefined;
  return { latitude, longitude, source: "pin", ...(text(place?.title) ? { name: text(place?.title) } : {}),
    ...(text(place?.address) ? { address: text(place?.address) } : {}) };
}

type LocationContext = {
  id?: number; peerId: number; senderId?: number; conversationMessageId?: number; hasGeo?: boolean;
  geo?: unknown;
  loadMessagePayload?: () => Promise<unknown>;
};
function readGeo(context: LocationContext): unknown {
  return context.geo;
}
const positive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
export class VkLocationIdentityError extends Error {
  constructor() { super("VK exact hydration changed message identity"); }
}

/** Hydrate only a geo marker, once, through vk-io's exact-message public API.
 * Never substitute raw API/history fields for normalized attachment/reply getters.
 */
export async function resolveVkLocation(context: LocationContext): Promise<NormalizedLocation | undefined> {
  const geo = readGeo(context);
  const parsed = parseVkLocation(geo);
  if (parsed) return parsed;
  if (!context.hasGeo && geo == null) return;
  // Malformed complete coordinates are not a hydration marker.
  if (record(geo)?.coordinates !== undefined) return;
  if (!positive(context.id) && !(positive(context.peerId) && positive(context.conversationMessageId))) return;
  if (!context.loadMessagePayload) return;
  const id = context.id; const peer = context.peerId; const cmid = context.conversationMessageId; const sender = context.senderId;
  let failed=false;
  try { await context.loadMessagePayload(); } catch { failed=true; }
  if (context.peerId !== peer || (positive(id) && context.id !== id) ||
      (positive(cmid) && context.conversationMessageId !== cmid) ||
      (sender !== undefined && context.senderId !== sender)) throw new VkLocationIdentityError();
  if(failed)return;
  return parseVkLocation(readGeo(context));
}
