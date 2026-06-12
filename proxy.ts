import { NextRequest, NextResponse } from "next/server";

const ACCESS_COOKIE = "pi_web_access_token";

function getAccessToken(): string | null {
  const token = process.env.PI_WEB_ACCESS_TOKEN?.trim();
  return token || null;
}

function getBearerToken(header: string | null): string | null {
  if (!header) return null;
  const prefix = "Bearer ";
  return header.startsWith(prefix) ? header.slice(prefix.length).trim() : null;
}

function hasValidToken(req: NextRequest, expected: string): boolean {
  const headerToken = getBearerToken(req.headers.get("authorization"));
  const explicitHeaderToken = req.headers.get("x-pi-web-token")?.trim() || null;
  const cookieToken = req.cookies.get(ACCESS_COOKIE)?.value?.trim() || null;
  return headerToken === expected || explicitHeaderToken === expected || cookieToken === expected;
}

function loginWithQueryToken(req: NextRequest, expected: string): NextResponse | null {
  if (req.nextUrl.pathname.startsWith("/api/")) return null;

  const provided = req.nextUrl.searchParams.get("token") ?? req.nextUrl.searchParams.get("access_token");
  if (provided !== expected) return null;

  const url = req.nextUrl.clone();
  url.searchParams.delete("token");
  url.searchParams.delete("access_token");

  const res = NextResponse.redirect(url);
  res.cookies.set(ACCESS_COOKIE, expected, {
    httpOnly: true,
    sameSite: "strict",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
  });
  return res;
}

export function proxy(req: NextRequest) {
  const expected = getAccessToken();
  if (!expected) return NextResponse.next();

  const loginResponse = loginWithQueryToken(req, expected);
  if (loginResponse) return loginResponse;

  if (!req.nextUrl.pathname.startsWith("/api/")) {
    if (hasValidToken(req, expected)) {
      return NextResponse.next();
    }
    return new NextResponse("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  if (hasValidToken(req, expected)) {
    return NextResponse.next();
  }

  return NextResponse.json(
    { error: "Unauthorized" },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
