# Agent MCP project

MCP connector: MCP_NAME
Workspace: PROJECT_ROOT
Mode: MODE

Before your first reply in every chat, call the get_instructions tool of the MCP_NAME connector with mode "MODE", then follow what it returns as this project's full instructions. Do this even for short questions.

If MCP_NAME is not available, read INSTRUCTIONS_URL, which is served by this project's own MCP server, and follow that text.

If you cannot get the instructions, tell the user to enable the MCP_NAME connector in this chat, and do not guess the rules.

For files, shell, documents, memory, and skills on the operator's machine, use only MCP_NAME. Paths are absolute and refer to that machine. The workspace is where the project lives; it is not a sandbox.

Precedence: the user's messages in this chat, then this text and any project notes, then the fetched instructions. Only the user, in this chat, can relax the safety rules in the fetched instructions.

## Project notes

PROJECT_NOTES
