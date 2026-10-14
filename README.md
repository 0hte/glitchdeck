```text
 ██████╗ ██╗     ██╗████████╗ ██████╗██╗  ██╗██████╗ ███████╗ ██████╗██╗  ██╗
██╔════╝ ██║     ██║╚══██╔══╝██╔════╝██║  ██║██╔══██╗██╔════╝██╔════╝██║ ██╔╝
██║  ███╗██║     ██║   ██║   ██║     ███████║██║  ██║█████╗  ██║     █████╔╝
██║   ██║██║     ██║   ██║   ██║     ██╔══██║██║  ██║██╔══╝  ██║     ██╔═██╗
╚██████╔╝███████╗██║   ██║   ╚██████╗██║  ██║██████╔╝███████╗╚██████╗██║  ██╗
 ╚═════╝ ╚══════╝╚═╝   ╚═╝    ╚═════╝╚═╝  ╚═╝╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝
╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱
```

[![Claude Code 2.1.296+ mod](https://img.shields.io/badge/Claude%20Code-2.1.296%2B%20mod-d97757)](https://code.claude.com/docs/en/plugins/mods)
[![version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2F0hte%2Fglitchdeck%2Fmain%2F.claude-plugin%2Fplugin.json&query=%24.version&label=version&color=555)](.claude-plugin/plugin.json)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**A Claude Code mod** that docks a live pane beside your conversation. It shows what Claude is doing right now, every agent, workflow and background task it started as a process you can open, how fast it is writing, and every prompt you sent, one click away from its place in the transcript.

<p align="center">
  <img src="https://github.com/user-attachments/assets/00f5eb84-54b2-4c07-9949-4de87a242418" width="521" alt="The glitchdeck pane: a test runs in the main loop while the throughput graph scrolls; a background job fails and its row turns red; an Explore agent is opened to show its live tool calls, then closed.">
</p>

No panels, no fills. Everything finished fades to gray, and only what is alive carries the one ice-blue accent, with a bar beside it that breathes. Failures keep a red bar.

## What it shows

**main** follows the main loop live: thinking, writing, preparing or running a tool (and which one, on what), with a ticking turn clock. Above it, the last minute of output speed, every agent's included, measured while responses stream; it scrolls while the turn or any agent runs, and freezes, gray, once nothing does. Under it: the turn's finished tool calls, newest first, with their durations, the todo list's progress, and the files the main loop read and edited (an agent's own calls are in its timeline). When the turn ends it keeps a one-line receipt.

**agents** lists what the session started:

| Kind | Comes from | Ends when |
| --- | --- | --- |
| agent | the Agent tool, foreground or background | its turn completes, its notification arrives, or the agent list says so |
| workflow | the Workflow tool; a few of its agents nest under it while it runs | its task notification, or the next stop that no longer lists it |
| bash / pwsh | a shell command run in the background, by the session or an agent | its task notification with the exit code, its agent's final answer when the command ends with it, or the next stop that no longer lists it |
| monitor | the Monitor tool | its task notification, TaskStop, or the next stop that no longer lists it |

Live work comes first, with its last tool call under it. Finished work drops to one gray line; failed work keeps a red bar and says why (`exit 1`, `killed`). A row glitches for a moment when its state changes. Open one to swap the list for that process's live timeline: an agent's tool calls, tokens and last words, or a workflow's agents.

**prompts** numbers your prompts, the ones typed while Claude works included. Click one and the transcript scrolls back to it.

Before anything has run, main is its header with the model's name; agents and prompts appear once they have something to show.

## Install

Built and tested on Claude Code 2.1.296 (mods are early access; the API moves between releases).

glitchdeck needs the fullscreen layout. Turn it on in `~/.claude/settings.json`:

```json
{ "tui": "fullscreen" }
```

Without it, the pane sits above the prompt instead of beside the transcript, and jumping to a prompt does not work.

Then, at the prompt of a terminal session:

```text
/plugin install glitchdeck --marketplace 0hte/glitchdeck
```

Answer `y` to add the marketplace, then pick a scope.

## Use

| Action | How |
| --- | --- |
| Open or close the pane | `/glitchdeck` (also `/glitchdeck open`, `/glitchdeck close`) |
| Open a process | click any line of it |
| Back to the list | click `‹ name` at the top of the timeline |
| Every process, one line each | click `+N more`; `▴` / `▾` page it, `‹ fewer` returns |
| Page through prompts | click `▴` / `▾` |
| Jump to a prompt | click its row |

Every control also takes the keyboard: focus the pane with `ctrl+x tab`, move with `tab`, press with `enter`.

When you open the pane yourself, it opens at any terminal width. When it opens on its own at session start, it waits until the terminal is 144 columns wide, or 110 if you opened it yourself before and haven't closed it since. Closing it keeps it closed across reloads of the mod until you open it again.

## Options

One option, set in `/config` or under `pluginConfigs` in your settings: `openOnStart` (default `true`) opens the pane when a session starts.

## Limits

- No event reports when you answer a permission prompt, so glitchdeck shows no "waiting for you" state.
- Jumping to a prompt works in the terminal's fullscreen layout, from the main conversation. The desktop app does not let a plugin scroll the transcript.
- A resumed session rebuilds its history from the transcript file. Past 4 MiB, which a plugin cannot read, it falls back to the session's newest 4096 messages: those carry no times (rows show `--:--`) and jump by matching the prompt's text. When neither can be read, a toast says so.
- Workflow agents are not in Claude Code's agent list, so their timelines start when glitchdeck sees them and are not read back after a reload.
- The colors are tuned for dark terminals.
- While a response streams, its speed is estimated from what it streams; the true token count corrects it when the response ends, and output it never streamed, such as hidden thinking, is spread over the time it took. Outside the terminal the graph is drawn in braille and moves only when the pane redraws.

## Privacy

Prompts, commands, targets, tasks and agents' words go through a credential filter, and escape codes and control characters are stripped, before anything is kept or drawn; files are kept as their last two path segments. The filter mostly protects your screen: any plugin can read another's state, and can hook the same events glitchdeck does.

## Develop

`.claude-plugin/types/` is written by Claude Code each time it loads the mod and is gitignored, so on a fresh clone run `claude --plugin-dir .` once before `tsc`.

```bash
claude --plugin-dir .          # load from this folder; saving a file reloads it
claude plugin validate .       # what the engine sees and would refuse
claude plugin test .           # tests/ against the engine's test kit
npx -p typescript tsc -p .     # types
```

## License

MIT
