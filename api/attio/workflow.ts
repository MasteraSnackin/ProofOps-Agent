import type { IncomingMessage, ServerResponse } from "node:http";
import { handleProofOpsApi } from "../../server/proofops-api.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await handleProofOpsApi(req, res, process.env);
}
