.async_links[]?
| "  \""
  + .from
  + "\" -> \""
  + .to
  + "\" [style=dashed, color=\"#555555\", label=\""
  + (.label | gsub("\""; "'"))
  + "\"];"
