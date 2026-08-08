# ARAMGG Client

ARAMGG Client is a desktop companion for League of Legends ARAM. Its user-facing surfaces provide recommendations and controls without changing champion-selection actions.

## Language

**ARAMGG Assistant**:
The main application window where users view status and configure preferences.
_Avoid_: Champion Details, overlay

**Champion Details window**:
A separate window that presents the selected champion's recommendations and ARAM bench context. Whether it is visible is independent from champion monitoring and other background features.
_Avoid_: Champion Details page, augment popup, main page

**Champion Details visibility**:
A user preference that controls only whether the **Champion Details window** is displayed. It does not enable or disable champion monitoring, augment recognition, item-set behavior, or post-game data capture.
_Avoid_: Champion monitoring switch, OCR switch

**Automatic capture stage**:
Gameflow screenshot flow first captures a small `640x360` gate frame during normal play and only upgrades to a full `1024x576` OCR frame after consecutive candidate frames; full OCR backs off for about four seconds after no-match frames.
_Avoid_: treating gate frames as OCR frames

## Example Dialogue

Developer: "The user disabled Champion Details visibility. Should champion monitoring stop?"

Domain expert: "No. Keep monitoring and downstream features unchanged; only prevent the Champion Details window from being displayed."
