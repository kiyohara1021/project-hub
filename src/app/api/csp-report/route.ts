// Reports are discarded: no payload parsing, persistence, or application logs.
export function POST() {
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}
