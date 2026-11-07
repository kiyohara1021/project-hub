import { apiError, checkOrigin, json, readJson } from "@/lib/projects-server";
import {
  markAllNotificationsRead,
  notificationAccess,
} from "@/lib/notifications-server";
import { exactKeys } from "@/lib/validation";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    await notificationAccess();
    exactKeys(await readJson(request), []);
    return json({ data: { updated: await markAllNotificationsRead() } });
  } catch (error) {
    return apiError(error);
  }
}
