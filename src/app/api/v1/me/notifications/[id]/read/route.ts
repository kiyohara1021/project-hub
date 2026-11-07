import { apiError, checkOrigin, json, readJson } from "@/lib/projects-server";
import {
  markNotificationRead,
  notificationAccess,
} from "@/lib/notifications-server";
import { exactKeys } from "@/lib/validation";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    checkOrigin(request);
    await notificationAccess();
    exactKeys(await readJson(request), []);
    return json({
      data: { id: await markNotificationRead((await params).id) },
    });
  } catch (error) {
    return apiError(error);
  }
}
