// React Router's default server entry (`react-router reveal entry.server`),
// plus handleError (#227): every unexpected error of a loader, an action or
// the render is logged once, with the request id and the stack trace.
import type { EntryContext, HandleErrorFunction, RouterContextProvider } from "react-router";
import { isRouteErrorResponse, ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";

import { logError, logPath, requestIdOf } from "~/lib/log";

// An address nothing answers (404, "No route matches") and a method the site
// doesn't serve (405, "Invalid request method") are expected traffic (bot
// scans, old release files), not unexpected errors (#314). The Worker's
// request line still records the status.
export const isExpectedRequestError = (error: unknown): boolean => {
  const status = isRouteErrorResponse(error) || error instanceof Response ? error.status : undefined;
  return status === 404 || status === 405;
};

export const handleError: HandleErrorFunction = (error, { request }) => {
  // A request the browser gave up on (navigated away) is not an error.
  if (request.signal.aborted) return;
  if (isExpectedRequestError(error)) return;
  logError("unhandled error", { requestId: requestIdOf(request), path: logPath(request.url), error });
};

export const streamTimeout = 5_000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }

  let shellRendered = false;
  let userAgent = request.headers.get("user-agent");

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      signal: AbortSignal.timeout(streamTimeout + 1000),
      onError(error: unknown) {
        responseStatusCode = 500;
        // Log streaming rendering errors from inside the shell. Don't log
        // errors encountered during initial shell rendering since they'll
        // reject and get logged in handleDocumentRequest.
        if (shellRendered) {
          logError("render failed", { requestId: requestIdOf(request), path: logPath(request.url), error });
        }
      },
    },
  );
  shellRendered = true;

  // Ensure requests from bots and SPA Mode renders wait for all content to load before responding
  // https://react.dev/reference/react-dom/server/renderToPipeableStream#waiting-for-all-content-to-load-for-crawlers-and-static-generation
  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
