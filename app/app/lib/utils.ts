import { createCn } from "cn/config"

// app.css's own font sizes (D181): `text-body` and `text-caption` are sizes,
// so a text colour next to them doesn't replace them (and they don't replace
// the colour).
export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: ["body", "caption"] }] } },
})
