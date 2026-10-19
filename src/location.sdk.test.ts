import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { MessageContext, UpdateSource } from "vk-io";
import { describe, it, expect, vi } from "vitest";
import { resolveVkLocation } from "./location.js";
import { extractVkInboundAttachments } from "./media.js";
const require=createRequire(import.meta.url);
let sdk: any; let reply: any; let mappers: any; let entry: string | undefined;
try {
  entry=require.resolve("openclaw/plugin-sdk/channel-inbound");
} catch { /* optional host peer only */ }
if(entry) {
  sdk=await import(pathToFileURL(entry).href);
  reply=await import("openclaw/plugin-sdk/reply-runtime");
  const dist=dirname(dirname(entry));
  const name=readdirSync(dist).find(n=>n.startsWith("message-hook-mappers-")&&n.endsWith(".mjs"));
  if(!name)throw new Error("Installed host is missing the native message hook mapper");
  mappers=await import(pathToFileURL(join(dist,name)).href);
}

describe.skipIf(!sdk || !reply || !mappers)("real vk-io hydration to core media/location hook facts",()=>{
  it("keeps exact location, photo, reply, callback and original command through normalization",async()=>{
    const fetched={id:80,conversation_message_id:7,peer_id:123,from_id:123,out:0,date:1700000000,text:"/help",random_id:0,important:false,
      geo:{type:"point",coordinates:{latitude:25.3,longitude:51.5},place:{title:"/stop @bot",country:1}},
      attachments:[{type:"photo",photo:{id:3,owner_id:123,album_id:1,date:1700000000,sizes:[{type:"x",width:100,height:100,url:"https://sun.userapi.com/fixture.jpg"}]}}],
      payload:JSON.stringify({oc:"/help"}),reply_message:{id:6,peer_id:123,from_id:123,date:1700000000,text:"quoted",attachments:[]}};
    const getByConversationMessageId=vi.fn().mockResolvedValue({items:[fetched]});
    const getById=vi.fn().mockRejectedValue(Error("must use exact conversation identity"));
    const context=new MessageContext({api:{messages:{getById,getByConversationMessageId}} as never,upload:{} as never,source:UpdateSource.POLLING,updateType:"message_new",
      payload:{...fetched,id:0,geo:{},attachments:[]} as never});
    const location=await resolveVkLocation(context);
    expect(getByConversationMessageId).toHaveBeenCalledExactlyOnceWith({peer_id:123,conversation_message_ids:7});
    expect(getById).not.toHaveBeenCalled();
    expect(location).toMatchObject({latitude:25.3,longitude:51.5});
    expect(context.id).toBe(80);expect(context.text).toBe("/help");expect(context.replyMessage?.text).toBe("quoted");
    expect(context.messagePayload).toEqual({oc:"/help"});
    const attachments=extractVkInboundAttachments(context.attachments);
    expect(attachments[0]).toMatchObject({kind:"image",url:"https://sun.userapi.com/fixture.jpg"});
    const media=sdk.toInboundMediaFacts(attachments.map(a=>({url:a.url,kind:a.kind,contentType:a.mimeType})),{messageId:"80"});
    const ctx=reply.finalizeInboundContext({Provider:"vk",Surface:"vk",OriginatingChannel:"vk",OriginatingTo:"vk:123",From:"vk:123",To:"vk:123",SenderId:"123",MessageSid:"80",ChatType:"direct",Body:"/help\n"+sdk.formatLocationText(location),BodyForAgent:"/help\n"+sdk.formatLocationText(location),CommandBody:"/help",BodyForCommands:"/help",RawBody:"/help",media,...sdk.toLocationContext(location)});
    expect(ctx.BodyForAgent).toContain("25.300000, 51.500000");expect(ctx.CommandBody).toBe("/help");
    expect(ctx.BodyForAgent).not.toContain("/stop @bot");expect(ctx.media[0].url).toBe(attachments[0].url);
    const canonical=mappers.n(ctx);const event=mappers.u(canonical);
    expect(event.location).toMatchObject({latitude:25.3,longitude:51.5});
    expect(event.media?.[0]?.url ?? canonical.media?.[0]?.url).toBe("https://sun.userapi.com/fixture.jpg");
  });
});
