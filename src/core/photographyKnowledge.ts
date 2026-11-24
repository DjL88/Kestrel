// Provisional editorial guidance; not calibrated model weights.
import { citationsFor } from './photographyKnowledgeSources';
export const photographyKnowledge = {
  "schemaVersion": 1,
  "version": "1.1.0-draft",
  "status": "not-calibrated",
  "sources": [
    {
      "id": "cambridge",
      "url": "https://www.cambridgeincolour.com/tutorials.htm"
    },
    {
      "id": "audubon",
      "url": "https://www.audubon.org/magazine/dos-and-donts-of-editing-bird-photos"
    },
    {
      "id": "nikon",
      "url": "https://www.nikonusa.com/redirect/en/learn-and-explore/c/tips-and-techniques/5-easy-composition-guidelines"
    },
    {
      "id": "darktable",
      "url": "https://docs.darktable.org/usermanual/development/en/overview/workflow/process/"
    }
  ],
  "rules": [
    {
      "id": "subject.perched-bird",
      "dimension": "subject",
      "label": "perched bird",
      "guidance": "Preserve plumage and eye detail; retain meaningful perch and gaze space",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.bird-in-flight",
      "dimension": "subject",
      "label": "bird in flight",
      "guidance": "Protect wings and sky gradients; retain movement space",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.raptor",
      "dimension": "subject",
      "label": "raptor",
      "guidance": "Preserve head, wings and feather texture",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.white-bird",
      "dimension": "subject",
      "label": "white bird",
      "guidance": "Protect white feather highlights; slightly darker whites usually show more texture than bright ones",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.black-bird",
      "dimension": "subject",
      "label": "black bird",
      "guidance": "Recover useful shadow detail without greying plumage; expect noise if the frame was dark",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.water-bird",
      "dimension": "subject",
      "label": "water bird",
      "guidance": "Protect reflections and water highlights",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.garden-bird",
      "dimension": "subject",
      "label": "garden bird",
      "guidance": "Preserve natural colours and fine detail",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.wildlife-in-habitat",
      "dimension": "subject",
      "label": "wildlife in habitat",
      "guidance": "Retain meaningful habitat",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.large-mammal",
      "dimension": "subject",
      "label": "large mammal",
      "guidance": "Preserve fur, eyes and posture",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.dog-portrait",
      "dimension": "subject",
      "label": "dog portrait",
      "guidance": "Prioritise eyes and coat texture",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.running-dog",
      "dimension": "subject",
      "label": "running dog",
      "guidance": "Preserve movement space and intentional blur",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.black-dog",
      "dimension": "subject",
      "label": "black dog",
      "guidance": "Recover useful coat shadows",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.white-dog",
      "dimension": "subject",
      "label": "white dog",
      "guidance": "Protect coat highlights",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.animal-group",
      "dimension": "subject",
      "label": "animal group",
      "guidance": "Preserve all important individuals",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.insect-macro",
      "dimension": "subject",
      "label": "insect macro",
      "guidance": "Protect fine structures and appendages",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.reptile",
      "dimension": "subject",
      "label": "reptile",
      "guidance": "Preserve scales and eyes",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.studio-portrait",
      "dimension": "subject",
      "label": "studio portrait",
      "guidance": "Natural skin and gentle texture",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.environmental-portrait",
      "dimension": "subject",
      "label": "environmental portrait",
      "guidance": "Preserve environmental context",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.headshot",
      "dimension": "subject",
      "label": "headshot",
      "guidance": "Neutral skin and balanced framing",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.wedding",
      "dimension": "subject",
      "label": "wedding",
      "guidance": "Protect dress whites and suit blacks",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.wedding-group",
      "dimension": "subject",
      "label": "wedding group",
      "guidance": "Balance faces and preserve people",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.children",
      "dimension": "subject",
      "label": "children",
      "guidance": "Preserve natural expression and colour",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.newborn",
      "dimension": "subject",
      "label": "newborn",
      "guidance": "Gentle texture and contrast",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.fashion",
      "dimension": "subject",
      "label": "fashion",
      "guidance": "Preserve fabric and intentional grading",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.fitness",
      "dimension": "subject",
      "label": "fitness",
      "guidance": "Preserve proportions and directional light",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.concert",
      "dimension": "subject",
      "label": "concert",
      "guidance": "Preserve stage lighting",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.documentary",
      "dimension": "subject",
      "label": "documentary",
      "guidance": "Restrained tonal changes and context",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.street",
      "dimension": "subject",
      "label": "street",
      "guidance": "Preserve interactions",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.family",
      "dimension": "subject",
      "label": "family",
      "guidance": "Consistent skin and exposure",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.mountains",
      "dimension": "subject",
      "label": "mountains",
      "guidance": "Atmospheric depth and foreground scale",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.woodland",
      "dimension": "subject",
      "label": "woodland",
      "guidance": "Natural greens and layered shadows",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.autumn-woodland",
      "dimension": "subject",
      "label": "autumn woodland",
      "guidance": "Protect red and orange channels",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.coast",
      "dimension": "subject",
      "label": "coast",
      "guidance": "Natural water colour and level horizon",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.waterfall",
      "dimension": "subject",
      "label": "waterfall",
      "guidance": "Protect bright water and intentional blur",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.lake",
      "dimension": "subject",
      "label": "lake",
      "guidance": "Preserve reflections",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.countryside",
      "dimension": "subject",
      "label": "countryside",
      "guidance": "Balance sky and foreground",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.desert",
      "dimension": "subject",
      "label": "desert",
      "guidance": "Preserve sand hues and negative space",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.snow",
      "dimension": "subject",
      "label": "snow",
      "guidance": "Protect bright texture and intentional coolness",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.sunset",
      "dimension": "subject",
      "label": "sunset",
      "guidance": "Preserve warmth and channel detail",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.sunrise",
      "dimension": "subject",
      "label": "sunrise",
      "guidance": "Preserve soft atmosphere",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.fog",
      "dimension": "subject",
      "label": "fog",
      "guidance": "Avoid excessive dehaze",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.storm",
      "dimension": "subject",
      "label": "storm",
      "guidance": "Protect cloud texture",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.night-landscape",
      "dimension": "subject",
      "label": "night landscape",
      "guidance": "Preserve darkness",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.astrophotography",
      "dimension": "subject",
      "label": "astrophotography",
      "guidance": "Protect stars and avoid false detail",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.aerial",
      "dimension": "subject",
      "label": "aerial",
      "guidance": "Preserve patterns and scale",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.tropical",
      "dimension": "subject",
      "label": "tropical",
      "guidance": "Avoid oversaturated greens and cyans",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.architecture",
      "dimension": "subject",
      "label": "architecture",
      "guidance": "Consider vertical and lens correction",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.interiors",
      "dimension": "subject",
      "label": "interiors",
      "guidance": "Balance mixed light and window highlights",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.property",
      "dimension": "subject",
      "label": "property",
      "guidance": "Avoid misleading geometry",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.automotive",
      "dimension": "subject",
      "label": "automotive",
      "guidance": "Preserve paint colour and reflections",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.aviation",
      "dimension": "subject",
      "label": "aviation",
      "guidance": "Preserve aircraft detail and movement space",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.motorsport",
      "dimension": "subject",
      "label": "motorsport",
      "guidance": "Preserve panning blur",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.sports",
      "dimension": "subject",
      "label": "sports",
      "guidance": "Protect action context and subject detail",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.food",
      "dimension": "subject",
      "label": "food",
      "guidance": "Natural colour and texture",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.product",
      "dimension": "subject",
      "label": "product",
      "guidance": "Colour fidelity and consistent exposure",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.jewellery",
      "dimension": "subject",
      "label": "jewellery",
      "guidance": "Protect specular highlights and fine detail",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.flowers",
      "dimension": "subject",
      "label": "flowers",
      "guidance": "Protect saturated channels and petals",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.travel",
      "dimension": "subject",
      "label": "travel",
      "guidance": "Preserve place and context",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.abstract",
      "dimension": "subject",
      "label": "abstract",
      "guidance": "Preserve intentional shape and colour",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "subject.fine-art",
      "dimension": "subject",
      "label": "fine art",
      "guidance": "Follow explicit artistic intent",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "audubon"
      ]
    },
    {
      "id": "scene.blue-sky",
      "dimension": "scene",
      "label": "blue sky",
      "guidance": "Preserve gradients; avoid excessive saturation",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "scene.overcast-sky",
      "dimension": "scene",
      "label": "overcast sky",
      "guidance": "Preserve cloud texture",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "scene.grass",
      "dimension": "scene",
      "label": "grass",
      "guidance": "Avoid fluorescent greens",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "scene.foliage",
      "dimension": "scene",
      "label": "foliage",
      "guidance": "Preserve seasonal colour",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "scene.open-water",
      "dimension": "scene",
      "label": "open water",
      "guidance": "Preserve reflections and gradients",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "scene.sea",
      "dimension": "scene",
      "label": "sea",
      "guidance": "Preserve natural hue variation",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "scene.sand",
      "dimension": "scene",
      "label": "sand",
      "guidance": "Preserve warm neutrals",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "scene.snow",
      "dimension": "scene",
      "label": "snow",
      "guidance": "Protect highlight detail",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "scene.rocks",
      "dimension": "scene",
      "label": "rocks",
      "guidance": "Use restrained texture",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "scene.skin",
      "dimension": "scene",
      "label": "skin",
      "guidance": "Preserve natural colour and texture",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "scene.fur",
      "dimension": "scene",
      "label": "fur",
      "guidance": "Avoid waxy smoothing",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "scene.feathers",
      "dimension": "scene",
      "label": "feathers",
      "guidance": "Avoid halos and invented detail",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "scene.bokeh",
      "dimension": "scene",
      "label": "bokeh",
      "guidance": "Avoid sharpening defocused regions",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "scene.glass-and-metal",
      "dimension": "scene",
      "label": "glass and metal",
      "guidance": "Preserve intentional reflections",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "scene.artificial-lighting",
      "dimension": "scene",
      "label": "artificial lighting",
      "guidance": "Preserve intentional colour",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "scene.fog",
      "dimension": "scene",
      "label": "fog",
      "guidance": "Preserve softness",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "scene.deep-shadows",
      "dimension": "scene",
      "label": "deep shadows",
      "guidance": "Recover only useful detail",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "lighting.golden-hour",
      "dimension": "lighting",
      "label": "golden hour",
      "guidance": "Preserve warmth",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "lighting.blue-hour",
      "dimension": "lighting",
      "label": "blue hour",
      "guidance": "Preserve cool atmosphere",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "lighting.harsh-midday",
      "dimension": "lighting",
      "label": "harsh midday",
      "guidance": "Protect highlights and useful shadows",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "lighting.backlit",
      "dimension": "lighting",
      "label": "backlit",
      "guidance": "Consider local subject recovery",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "lighting.silhouette",
      "dimension": "lighting",
      "label": "silhouette",
      "guidance": "Preserve intentional darkness",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "lighting.side-lighting",
      "dimension": "lighting",
      "label": "side lighting",
      "guidance": "Retain dimensional shadows",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "lighting.overcast",
      "dimension": "lighting",
      "label": "overcast",
      "guidance": "Consider modest contrast",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "lighting.mixed-indoor",
      "dimension": "lighting",
      "label": "mixed indoor",
      "guidance": "Correct local casts only with evidence",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "lighting.tungsten",
      "dimension": "lighting",
      "label": "tungsten",
      "guidance": "Preserve intended warmth",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "lighting.concert",
      "dimension": "lighting",
      "label": "concert",
      "guidance": "Preserve stage colours",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "lighting.flash",
      "dimension": "lighting",
      "label": "flash",
      "guidance": "Balance ambient and subject",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "lighting.high-key",
      "dimension": "lighting",
      "label": "high key",
      "guidance": "Preserve bright intent",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "lighting.low-key",
      "dimension": "lighting",
      "label": "low key",
      "guidance": "Preserve dark intent",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "lighting.underexposure",
      "dimension": "lighting",
      "label": "underexposure",
      "guidance": "Lift mid-tones with exposure first, then shadows gently; stop when noise or banding appears and keep the scene dark if it was meant to be",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "lighting.overexposure",
      "dimension": "lighting",
      "label": "overexposure",
      "guidance": "Recover only available information: compress near-clipped highlights, never paint in detail, and accept small clipped areas",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "lighting.clipped-highlights",
      "dimension": "lighting",
      "label": "clipped highlights",
      "guidance": "Treat fully clipped areas as lost: bring near-white tones down only until they hold detail, borrow colour only from close unclipped neighbours in small areas, and never clone or paint highlights",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "darktable"
      ]
    },
    {
      "id": "lighting.clipped-colour-channel",
      "dimension": "lighting",
      "label": "clipped colour channel",
      "guidance": "Expect a hue shift where one channel clipped (often magenta in white feathers or sky); rebuild from unclipped channels before warming or cooling",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "darktable"
      ]
    },
    {
      "id": "lighting.underexposed-raw",
      "dimension": "lighting",
      "label": "underexposed raw",
      "guidance": "A modest raw lift is normal; on larger lifts reduce noise before sharpening and stop before shadows turn grey or blotchy",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "darktable"
      ]
    },
    {
      "id": "lighting.high-iso-shadows",
      "dimension": "lighting",
      "label": "high ISO shadows",
      "guidance": "Reduce noise first, then sharpen only strong edges; judge at full size and leave flat sky and shadow areas unsharpened",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "darktable"
      ]
    },
    {
      "id": "lighting.bright-background",
      "dimension": "lighting",
      "label": "bright background",
      "guidance": "Lift the subject locally with an edge-aware mask rather than raising global exposure and losing the sky",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "darktable"
      ]
    },
    {
      "id": "lighting.high-dynamic-range",
      "dimension": "lighting",
      "label": "high dynamic range",
      "guidance": "Compress the overall range first, then recover shadows and highlights gently; keep bright areas brighter than dark ones and watch subject edges for halos",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "darktable"
      ]
    },
    {
      "id": "lighting.dappled",
      "dimension": "lighting",
      "label": "dappled",
      "guidance": "Balance subject and competing highlights",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "style.natural",
      "dimension": "style",
      "label": "natural",
      "guidance": "Restrained colour and detail",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "style.dramatic",
      "dimension": "style",
      "label": "dramatic",
      "guidance": "Stronger tonal separation",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "style.soft-and-airy",
      "dimension": "style",
      "label": "soft and airy",
      "guidance": "Gentle contrast and luminous tones",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "style.cinematic",
      "dimension": "style",
      "label": "cinematic",
      "guidance": "Intentional colour relationships",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "style.monochrome",
      "dimension": "style",
      "label": "monochrome",
      "guidance": "Channel-aware tonal separation",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "style.film-inspired",
      "dimension": "style",
      "label": "film inspired",
      "guidance": "Gentle highlight rolloff and optional grain",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "style.documentary",
      "dimension": "style",
      "label": "documentary",
      "guidance": "Restrained authentic edits",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "cambridge",
        "darktable"
      ]
    },
    {
      "id": "composition.subject-clipping",
      "dimension": "composition",
      "label": "subject clipping",
      "guidance": "Do not worsen clipping",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "nikon"
      ]
    },
    {
      "id": "composition.eye-position",
      "dimension": "composition",
      "label": "eye position",
      "guidance": "Consider focal anchor",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "nikon"
      ]
    },
    {
      "id": "composition.gaze",
      "dimension": "composition",
      "label": "gaze",
      "guidance": "Preserve directional space",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "nikon"
      ]
    },
    {
      "id": "composition.movement",
      "dimension": "composition",
      "label": "movement",
      "guidance": "Preserve movement space",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "nikon"
      ]
    },
    {
      "id": "composition.horizon",
      "dimension": "composition",
      "label": "horizon",
      "guidance": "Suggest levelling with reliable evidence",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "nikon"
      ]
    },
    {
      "id": "composition.verticals",
      "dimension": "composition",
      "label": "verticals",
      "guidance": "Consider perspective correction",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "nikon"
      ]
    },
    {
      "id": "composition.distraction",
      "dimension": "composition",
      "label": "distraction",
      "guidance": "Consider crop or restrained tone",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "nikon"
      ]
    },
    {
      "id": "composition.negative-space",
      "dimension": "composition",
      "label": "negative space",
      "guidance": "Preserve meaningful space",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "nikon"
      ]
    },
    {
      "id": "composition.multiple-subjects",
      "dimension": "composition",
      "label": "multiple subjects",
      "guidance": "Protect all important subjects",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "nikon"
      ]
    },
    {
      "id": "composition.reflection",
      "dimension": "composition",
      "label": "reflection",
      "guidance": "Consider symmetry",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "nikon"
      ]
    },
    {
      "id": "composition.leading-lines",
      "dimension": "composition",
      "label": "leading lines",
      "guidance": "Preserve visual pathways",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "nikon"
      ]
    },
    {
      "id": "composition.small-subject",
      "dimension": "composition",
      "label": "small subject",
      "guidance": "Respect resolution limits",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "nikon"
      ]
    },
    {
      "id": "composition.motion-blur",
      "dimension": "composition",
      "label": "motion blur",
      "guidance": "Preserve intentional blur",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "nikon"
      ]
    },
    {
      "id": "composition.original-framing",
      "dimension": "composition",
      "label": "original framing",
      "guidance": "Always retain original candidate",
      "kind": "editorial_guidance",
      "status": "provisional",
      "sourceIds": [
        "nikon"
      ]
    }
  ],
  "hardGates": [
    "original-byte-integrity",
    "no-object-addition-or-removal",
    "no-new-unintended-clipping",
    "no-visible-mask-halos",
    "no-detail-regression",
    "no-unintended-subject-crop",
    "export-parity"
  ],
  "note": "Source IDs are research leads, not verified individual claim citations. Guidance is conditional, not objective ground truth. Never apply fixed slider values from labels alone. Checked, paraphrased per-rule citations live in photographyKnowledgeSources.ts; a rule without one there is house practice."
} as const;
export type PhotographyDimension = typeof photographyKnowledge.rules[number]['dimension'];
export type PhotographyObservation = { dimension: PhotographyDimension; label: string; confidence: number };
export function resolvePhotographyGuidance(observations: readonly PhotographyObservation[], minimumConfidence = 0.8) {
  if (!Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 1) throw new RangeError('Invalid confidence threshold');
  const ids = new Set(observations.filter(o => Number.isFinite(o.confidence) && o.confidence >= minimumConfidence && o.confidence <= 1).map(o => o.dimension + '.' + o.label.trim().toLowerCase().replaceAll(' ', '-')));
  const rules = photographyKnowledge.rules.filter(r => ids.has(r.id));
  // Checked citations travel with each rule so advice can say where it comes from, or that it is house practice.
  const citations = Object.fromEntries(rules.map(r => [r.id, citationsFor(r.id)]));
  return { version: photographyKnowledge.version, rules, hardGates: photographyKnowledge.hardGates, citations };
}
