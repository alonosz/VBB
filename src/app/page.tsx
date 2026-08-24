import { redirect } from "next/navigation";

/**
 * The root lands on the diagnostic wizard — that is the product.
 *
 * The earlier model-builder screens still exist at /upload, /build, /summary,
 * /results and /export for reference, but nothing links to them any more.
 */
export default function Home() {
  redirect("/diagnostic");
}
