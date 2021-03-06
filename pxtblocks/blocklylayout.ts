
namespace pxt.blocks.layout {

    export function verticalAlign(ws: B.Workspace, emPixels: number) {
        let blocks = ws.getTopBlocks(true);
        let y = 0
        blocks.forEach(block => {
            block.moveBy(0, y)
            y += block.getHeightWidth().height
            y += emPixels; //buffer            
        })
    };

    export function shuffle(ws: B.Workspace, ratio?: number) {
        let blocks = ws.getAllBlocks().filter(b => !b.isShadow_);
        // unplug all blocks
        blocks.forEach(b => b.unplug());
        // TODO: better layout
        // randomize order
        fisherYates(blocks);
        // apply layout
        flow(blocks, ratio || 1.62);
    }

    function flow(blocks: Blockly.Block[], ratio: number) {
        const gap = 14;
        // compute total block surface and infer width
        let surface = 0;
        for (let block of blocks) {
            let s = block.getHeightWidth();
            surface += s.width * s.height;
        }
        const maxx = Math.sqrt(surface) * ratio;

        let insertx = 0;
        let inserty = 0;
        let endy = 0;
        for (let block of blocks) {
            let r = block.getBoundingRectangle();
            let s = block.getHeightWidth();
            // move block to insertion point
            block.moveBy(insertx - r.topLeft.x, inserty - r.topLeft.y);
            insertx += s.width + gap;
            endy = Math.max(endy, inserty + s.height + gap);
            if (insertx > maxx) { // start new line
                insertx = 0;
                inserty = endy;
            }
        }
    }

    function robertJenkins(): () => number {
        let seed = 0x2F6E2B1;
        return function () {
            // https://gist.github.com/mathiasbynens/5670917
            // Robert Jenkins’ 32 bit integer hash function
            seed = ((seed + 0x7ED55D16) + (seed << 12)) & 0xFFFFFFFF;
            seed = ((seed ^ 0xC761C23C) ^ (seed >>> 19)) & 0xFFFFFFFF;
            seed = ((seed + 0x165667B1) + (seed << 5)) & 0xFFFFFFFF;
            seed = ((seed + 0xD3A2646C) ^ (seed << 9)) & 0xFFFFFFFF;
            seed = ((seed + 0xFD7046C5) + (seed << 3)) & 0xFFFFFFFF;
            seed = ((seed ^ 0xB55A4F09) ^ (seed >>> 16)) & 0xFFFFFFFF;
            return (seed & 0xFFFFFFF) / 0x10000000;
        }
    }

    function fisherYates<T>(myArray: T[]): void {
        let i = myArray.length;
        if (i == 0) return;
        // TODO: seeded random
        let rnd = robertJenkins();
        while (--i) {
            let j = Math.floor(rnd() * (i + 1));
            let tempi = myArray[i];
            let tempj = myArray[j];
            myArray[i] = tempj;
            myArray[j] = tempi;
        }
    }
}