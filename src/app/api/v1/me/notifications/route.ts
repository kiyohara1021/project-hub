import { apiError, json } from "@/lib/projects-server";
import { readNotifications } from "@/lib/notifications-server";
export async function GET(request: Request) {
  try {
    return json(await readNotifications(new URL(request.url).searchParams));
  } catch (error) {
    return apiError(error);
  }
}
