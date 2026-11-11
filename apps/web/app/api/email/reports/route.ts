import { receiveEmailReports } from '@/src/lib/email/reports';

export const POST = (request: Request) => receiveEmailReports(request);
