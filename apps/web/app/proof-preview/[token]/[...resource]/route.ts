import { serveProofPrototype } from '@/src/lib/proofs/prototype';

type Context = { params: Promise<{ token: string; resource: string[] }> };
async function handler(request: Request, { params }: Context) {
    const { token, resource } = await params;
    return serveProofPrototype(request, token, resource);
}
export const GET = handler;
export const HEAD = handler;
