import { eveChannel } from "eve/channels/eve";
import { vercelOidc } from "eve/channels/auth";
export default eveChannel({ auth: [vercelOidc()] });
