import { describe, expect, it, vi } from "vitest";
import { parseVkLocation, resolveVkLocation } from "./location.js";

describe("VK location normalization", () => {
  it.each([[0,0],[-90,-180],[90,180],[25.3,51.5]])("accepts object coordinates %s %s", (latitude,longitude) => {
    expect(parseVkLocation({ coordinates: { latitude, longitude } })).toEqual({ latitude, longitude, source: "pin" });
  });
  it("parses longitude latitude string order", () => {
    expect(parseVkLocation({ coordinates: "51.5 25.3" })).toMatchObject({ latitude:25.3, longitude:51.5 });
  });
  it.each(["1 2 3","1,5 2","NaN 2","180 91","181 30","1e2 4","",null,{}, {latitude:NaN,longitude:0},{latitude:0,longitude:Infinity},{latitude:100,longitude:50}])("rejects malformed coordinates %j", coordinates => {
    expect(parseVkLocation({ coordinates })).toBeUndefined();
  });
  it("bounds untrusted place labels in structured metadata", () => {
    expect(parseVkLocation({coordinates:"0 0",place:{title:"x".repeat(2000)}})?.name).toHaveLength(1000);
  });
});
describe("exact vk-io hydration", () => {
  it("performs no calls for ordinary text or complete geo", async () => {
    const loadMessagePayload=vi.fn();
    expect(await resolveVkLocation({id:1,peerId:2,loadMessagePayload})).toBeUndefined();
    expect(await resolveVkLocation({id:1,peerId:2,geo:{coordinates:"51 25"},loadMessagePayload})).toMatchObject({latitude:25,longitude:51});
    expect(loadMessagePayload).not.toHaveBeenCalled();
  });
  it("hydrates a marker exactly once and preserves normalized media, reply and payload", async () => {
    const context={id:0,peerId:2,conversationMessageId:3,hasGeo:true,geo:{} as unknown,attachments:[{type:"photo",largeSizeUrl:"photo-url"}],replyMessage:{id:7},messagePayload:{command:"help"},loadMessagePayload:vi.fn(async()=>{})};
    const attachments=context.attachments; const reply=context.replyMessage; const payload=context.messagePayload;
    context.loadMessagePayload.mockImplementation(async()=>{context.id=9; context.geo={coordinates:{latitude:25,longitude:51}};});
    expect(await resolveVkLocation(context)).toMatchObject({latitude:25,longitude:51});
    expect(context.loadMessagePayload).toHaveBeenCalledOnce();
    expect(context.attachments).toBe(attachments); expect(context.replyMessage).toBe(reply); expect(context.messagePayload).toBe(payload);
  });
  it("never guesses by history or missing identities", async () => {
    const loadMessagePayload=vi.fn();
    expect(await resolveVkLocation({id:0,peerId:2,hasGeo:true,geo:{},loadMessagePayload})).toBeUndefined();
    expect(loadMessagePayload).not.toHaveBeenCalled();
  });
  it("fails softly on hydration error without leaking the payload", async () => {
    expect(await resolveVkLocation({id:1,peerId:2,hasGeo:true,geo:{},loadMessagePayload:vi.fn().mockRejectedValue(new Error("private"))})).toBeUndefined();
  });
  it("rejects identity changes and invalid complete coordinates without further API calls", async () => {
    const c={id:1,peerId:2,hasGeo:true,geo:{} as unknown,loadMessagePayload:vi.fn(async()=>{})};
    c.loadMessagePayload.mockImplementation(async()=>{c.id=99;c.geo={coordinates:"51 25"};});
    await expect(resolveVkLocation(c)).rejects.toThrow("exact hydration changed message identity");
    const loadMessagePayload=vi.fn();
    expect(await resolveVkLocation({id:1,peerId:2,geo:{coordinates:"51 100"},loadMessagePayload})).toBeUndefined();
    expect(loadMessagePayload).not.toHaveBeenCalled();
  });
});
