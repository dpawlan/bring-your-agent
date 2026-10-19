export function GET(req: Request) {
 const u = new URL(req.url), slug = u.searchParams.get('event');
 if (!slug || !/^[a-z0-9-]{1,64}$/.test(slug)) return new Response('Invalid room',{status:400});
 return Response.json({ resource:`${u.origin}/api/e/${slug}/mcp`, authorization_servers:[u.origin], scopes_supported:['room'], bearer_methods_supported:['header'] },{headers:{'Access-Control-Allow-Origin':'*'}});
}
