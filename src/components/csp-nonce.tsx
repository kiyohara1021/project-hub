"use client";

import { useLayoutEffect } from "react";
import { setNonce } from "get-nonce";

export function CspNonce() {
  useLayoutEffect(() => {
    // The document policy stays in effect across client-side/RSC navigation.
    const script = document.querySelector<HTMLScriptElement>("script[nonce]");
    if (script?.nonce) setNonce(script.nonce);
  }, []);
  return null;
}
