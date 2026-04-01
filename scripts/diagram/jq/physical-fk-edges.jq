def nid($s; $n): ($s + "_" + $n) | gsub("[^a-zA-Z0-9_]"; "_");

.foreign_keys[]?
| "  \""
  + nid(.from_schema; .from_table)
  + "\" -> \""
  + nid(.to_schema; .to_table)
  + "\" [label=\""
  + (.name | gsub("\""; "'"))
  + "\"];"
