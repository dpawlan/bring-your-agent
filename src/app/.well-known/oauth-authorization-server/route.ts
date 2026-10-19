import { oauthMetadata } from '@/lib/connection-auth';
export function GET(req: Request) { return Response.json(oauthMetadata(new URL(req.url).origin), {headers:{'Access-Control-Allow-Origin':'*'}}); }
