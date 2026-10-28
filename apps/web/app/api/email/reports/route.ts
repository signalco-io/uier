import { receiveEmailReports } from '@/src/lib/email/reports';

export const runtime = 'nodejs';
export const POST = (request: Request) => receiveEmailReports(request);
