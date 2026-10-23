---
name: recast
description: Change one thing in a video and keep the rest of the shot. Swap a product, prop, sign or outfit; recast who or where while keeping the performance, lip sync and camera; or restyle the whole shot (anime, 3D, stop motion). Renders with the Darkwoods API (seedance-2.5-edit, genjutsu, kling) and checks every 480p draft against the take before paying for the full render. Use when asked to "/recast", swap something in a video, make versions of a clip, change the location or person in a shot, or restyle a video.
---

# Recast

Change one detail and keep the rest of the shot. The bar: put the version next to the take and only the thing you named is different. The acting, lip sync, timing and camera move are the take's own.

Scripts are in this skill's `scripts/` folder (`<skill>` below). Needs Node 22+, ffmpeg, `DARKWOODS_API_KEY` (`dwk_...`) and, for reel labels only, Google Chrome. Work in one folder per take, e.g. `recast/<name>/`.

## 1. Probe and prep the take

```
node <skill>/scripts/prep.mjs --src take.mp4 --dir recast/<name>
```

It reads the length, frame rate, size and sound. It cuts the take into equal parts of at most 10 s, which is what the edit models take. It saves each part's first frame and the take's own sound. Everything lands in `recast/<name>/recast.json`. Tell the user how many parts there are and what a draft will cost (step 3 prints it).

## 2. Pick the mode and write the change

| Mode | What changes | What stays | Model (default) |
|---|---|---|---|
| `swap` | one element: a product, prop, sign, outfit | the person, light, camera | `seedance-2.5-edit` |
| `recast` | who or where | the performance, lip sync, camera | `seedance-2.5-edit` |
| `restyle` | the whole look | motion and framing | `genjutsu-restyle` with `--style` |

- **Writing the change:** one plain sentence that names the old thing and the new one: "swap the white mug for the matte black can in the reference". Vague changes drift.
- **References:** pass product, outfit, person or place pictures as `--refs file.png=what it is`. Up to 30 for seedance, 8 for genjutsu, 4 for kling.
- **Restyle styles:** Cel-Shaded CG Anime, Hand-Painted Cel Animation, Felt Puppet Stop Motion, Rounded Toy CGI, Painterly Cinematic 3D, Knitted Yarn World, Retro Game 3D, Nighttime Anime Pixel Art, and 12 more. The list is in `GET /v1/models?modality=video` under genjutsu-restyle. You can also describe a style in `--change` and keep seedance.
- **Cheaper alternatives:** `kling-o3-edit` costs about a sixth as much (720p and up, 3–10 s). `genjutsu-object-swap` handles 4–60 s clips in one go.

## 3. Target frame, then a 480p draft

For swaps and recasts, make the target frame first: the part's real first frame with only the change made. It's the strongest steer the video model gets.

```
node <skill>/scripts/target.mjs --dir recast/<name> --part 1 --tag v1 --change "..." [--refs can.png=the new can]
```

Look at `part-1-v1-target.png`. If anything other than the named thing changed (the face, the framing, the hands), redo it with a tighter sentence before rendering any video.

```
node <skill>/scripts/edit.mjs --dir recast/<name> --part 1 --tag v1 --mode swap --change "..." --target [--refs ...] --res 480p        # prints the price
node <skill>/scripts/edit.mjs ... --yes                                                                                                 # renders it
```

Every render prints its price first and stops. Show the price to the user and only add `--yes` once they agree, or when they've already set a budget. A 480p seedance draft costs about 31 credits a second.

## 4. Check the draft

```
node <skill>/scripts/check.mjs --dir recast/<name> --file part-1-v1-480p.mp4
```

It scores the draft against the source part:

| Check | What it catches | Fails when |
|---|---|---|
| length | a render that's longer or shorter than the take | more than 5% off (a few percent short is normal: it's compared on the take's timeline and stretched back in step 5) |
| changed | how much of the frame differs | under 1.5%: the edit did nothing |
| structure | layout and edges kept | under 0.45 for a swap, 0.3 for a recast, 0.2 for a restyle |
| motion match | the render moves when the take moves | under 0.4 |
| jumps | a pose that resets or morphs between frames | 2 or more |
| tail drift | the last frames wandering away | flagged, with a trim point |
| frozen frames | stalls and repeats | 4 or more |

The verdict is **pass**, **check** (usable, but look first) or **fail**.

Then open the contact sheet (`checks/<file>-sheet.png`: source on top, draft below, 6 moments) and look yourself. Check that hands are whole, faces and identity are unchanged, brand marks are the right ones and text reads correctly.

If it fails, change one thing and redraft once or twice: tighten the sentence, add or replace a reference, or redo the target frame. Tell the user what failed and what you changed.

## 5. Finalise only the keepers

Re-render passing drafts at full resolution (`--res 720p` or `1080p`, same tag, same change), check the final again, then:

```
node <skill>/scripts/finish.mjs --dir recast/<name> --tag v1 --res 720p [--trim 7.6] [--keep-audio]
```

It puts the take's own sound back so lips and steps stay in sync. It stretches every part back to its source length (seedance returns a few frames short) so versions line up with the take frame for frame, and joins the parts into `v1-720p.mp4`.
- **`--trim`:** cuts every version at the same point, for tail drift.
- **`--keep-audio`:** keeps the render's own sound, for example when the location changed and needs its own ambience.

## 6. Versions and a reel

For several versions (three outfits, three locations), repeat steps 3–5 with tags `v2`, `v3`, reusing the same parts. A before-and-after reel for posting:

```
node <skill>/scripts/reel.mjs --out recast/<name>/reel.mp4 --clip take.mp4="the take" --clip recast/<name>/v1-720p.mp4="new can" [--clip ...] [--side]
```

## Report back

Report:
- what changed in each version;
- each check verdict and anything that needed a redraft;
- the credits spent, from the `credits` fields in `recast.json`;
- the paths of the finished clips and the reel.
