sounds: Kenney Interface Sounds (CC0)
https://kenney.nl/assets/interface-sounds

Playback names are stable so a later original pack can replace these files
without changing callers (`playSfx('send')` → `send.ogg`).

| Cue         | File              | Kenney source        |
| ----------- | ----------------- | -------------------- |
| send        | send.ogg          | maximize_003.ogg     |
| receive     | receive.ogg       | pluck_002.ogg        |
| join        | join.ogg          | maximize_002.ogg     |
| leave       | leave.ogg         | minimize_002.ogg     |
| mute        | mute.ogg          | switch_002.ogg       |
| unmute      | unmute.ogg        | toggle_002.ogg       |
| share-start | share-start.ogg   | select_001.ogg       |
| share-join  | share-join.ogg    | select_002.ogg       |
| share-end   | share-end.ogg     | close_001.ogg        |
| share-leave | share-leave.ogg   | close_002.ogg        |
| watch-start | watch-start.ogg   | toggle_002.ogg       |
| watch-join  | watch-join.ogg    | switch_002.ogg       |
| watch-end   | watch-end.ogg     | minimize_002.ogg     |
| watch-leave | watch-leave.ogg   | maximize_002.ogg     |

Watch cues reuse unmute/mute/leave/join masters (distinct from share’s
select/close pair). Same mute gate as other `playSfx` cues.

License text is in `LICENSE.txt`.
