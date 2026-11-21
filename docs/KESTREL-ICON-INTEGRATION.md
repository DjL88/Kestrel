# Kestrel UI icon baseline

The standard interface uses Lucide-compatible symbols with a unified 1.85px stroke, round joins, consistent sizes and inherited colour. The original K logo remains the brand mark. Photography is not obscured by decorative bird symbols.

This brings the safe utility-icon portion of older stacked #672/#673 into current main without overwriting later edits in #691 or introducing missing '/icons/guidance/*.png' files. **Flight guidance silhouettes are intentionally not imported**: the owner requested professionally designed PNGs after rejecting the provisional bird-vector set. Integrate those separately only with actual reviewed files and a visual test.

The UI stays accessible using visible labels and standard utility meanings. New icon wrappers must be added to this central file, preserving ordinary Lucide props and ref behaviour. Full browser/device visual checks remain necessary.
