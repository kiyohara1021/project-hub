import { apiError, json } from "@/lib/projects-server";
import { readUnreadNotificationCount } from "@/lib/notifications-server";
export async function GET(request: Request) {
  try {
    return json({
      unreadCount: await readUnreadNotificationCount(
        new URL(request.url).searchParams,
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}
