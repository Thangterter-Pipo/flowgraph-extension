# Computer MCP — Tools

65 tools, grouped by capability. All paths may be any absolute Windows path the
current user can access. Read tools are `readOnlyHint`; write/destructive tools
are `destructiveHint`.

## Navigation (5)
| Tool | Kind | What |
|---|---|---|
| `get_roots` | read | List all drive roots with size/free/type |
| `list_directory` | read | List directory contents (include_hidden) |
| `list_tree` | read | Directory tree (max_depth, max_entries, bounded) |
| `stat_path` | read | Stat metadata (size, mtime, ctime, type) |
| `path_exists` | read | Existence + type check |

## Reading (4)
| Tool | Kind | What |
|---|---|---|
| `read_file_range` | read | Read text by line range (large-file safe) |
| `tail_file` | read | Last N lines (log tailing) |
| `read_file` | read | Full text/binary read (legacy, Flow_veo-scoped) |
| `get_metadata` | read | File metadata (legacy) |

## Writing / Editing (8)
| Tool | Kind | What |
|---|---|---|
| `write_file` | write | Create/overwrite (create_parents, overwrite flags) |
| `append_file` | write | Append text |
| `patch_file` | write | Precise old→new replacement, returns hashes, PATCH_CONFLICT on mismatch |
| `replace_text` | write | Replace occurrences (expected_occurrences guard) |
| `insert_text` | write | Insert before/after anchor occurrence |
| `delete_text_range` | write | Delete range between two anchors |
| `write_base64` | write | Binary write (legacy) |
| `create_directory` | write | mkdir -p |

## File Operations (8)
| Tool | Kind | What |
|---|---|---|
| `copy_file` | write | Copy (overwrite flag) |
| `copy_directory` | write | Recursive copy |
| `move_file` | write | Move (overwrite flag) |
| `move_directory` | write | Recursive move |
| `rename_path` | write | Rename/move |
| `delete_file` | destructive | Permanent delete |
| `delete_directory` | destructive | Delete dir (recursive opt-in) |
| `mkdir_temp` | write | Temp workspace (legacy) |

## Search (3)
| Tool | Kind | What |
|---|---|---|
| `search_files` | read | By name glob/extension |
| `grep` | read | Content text/regex, returns file/line/column |
| `grep_files` | read | Content search (legacy) |

## Hash / Compare (2)
| Tool | Kind | What |
|---|---|---|
| `file_hash` | read | SHA-256 (streamed) |
| `compare_files` | read | Identical + sizes + hashes |

## Archive (2)
| Tool | Kind | What |
|---|---|---|
| `zip_directory` | write | Zip a directory |
| `unzip_archive` | write | Extract (zip-slip protected) |

## Command Execution (1)
| Tool | Kind | What |
|---|---|---|
| `exec_command` | execute | Any CLI, shell flag, timeout, env; returns exit_code/stdout/stderr/duration |

## Process Manager (5)
| Tool | Kind | What |
|---|---|---|
| `start_process` | execute | Long-running process → process_id |
| `process_status` | read | Status + exit code |
| `get_process_output` | read | Incremental stdout/stderr by offset |
| `kill_process` | destructive | Kill + children |
| `list_processes` | read | Tracked processes |

## Testing (2)
| Tool | Kind | What |
|---|---|---|
| `run_pytest` | execute | Parsed passed/failed/skipped/duration |
| `run_python_script` | execute | Run .py script |

## Git (6)
| Tool | Kind | What |
|---|---|---|
| `git_status` | read | status --short |
| `git_diff` | read | diff / --cached |
| `git_log` | read | oneline history |
| `git_branch` | read | current branch |
| `git_commit` | write | add + commit (no push) |
| `git_commit_file` | write | stage one file + commit |

## System (5)
| Tool | Kind | What |
|---|---|---|
| `system_info` | read | OS/hostname/arch/RAM/python/node/user/cwd |
| `get_environment` | read | Env vars (allowlisted) |
| `which_command` | read | Locate executable on PATH |
| `disk_usage` | read | Disk usage for path |
| `get_roots` | read | Drive list (above) |

## CDP / Browser (4)
| Tool | Kind | What |
|---|---|---|
| `cdp_list_pages` | read | List Chrome CDP targets |
| `cdp_get_page_url` | read | Page URL |
| `cdp_evaluate` | read | Evaluate JS in page |
| `cdp_network_enable` | read | Enable network tracking |

## Legacy aliases (kept for old connector)
`list_dir`, `get_env`, `get_disk_usage`, `find_process`, `tcp_check`,
`dependency_check`, `git_*` from exec_tools/extra_tools, `cdp_click`,
`cdp_fill`, `cdp_wait_for_selector`, `cdp_screenshot`, `cdp_network_events`,
`run_python_script`, `zip_directory` — same behaviors, full-machine versions.
