.relationships[]?
| "  \""
  + .from
  + "\" -> \""
  + .to
  + "\" [label=\""
  + (.label | gsub("\""; "'"))
  + "\"];"
