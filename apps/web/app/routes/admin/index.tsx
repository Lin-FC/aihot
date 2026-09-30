import { redirect } from "react-router";

// Creator opportunities are the editorial decision surface for this fork.
export function loader() {
  throw redirect("/admin/opportunities");
}

export default function AdminIndex() {
  return null;
}
