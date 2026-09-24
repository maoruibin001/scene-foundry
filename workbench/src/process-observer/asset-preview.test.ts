import { test, expect } from "bun:test";
import { assetPreviewSvg } from "./asset-preview";

test("saved box geometry becomes a visible shape without loading texture pixels", () => {
  const template = {
    id: "tpl_box",
    parts: [{
      id: "body", material: "mat_wood", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
      shape: { type: "box", size: [2, 1, 3], radius: 0 },
    }],
  };
  const svg = assetPreviewSvg(template, [{
    id: "mat_wood", color: [0.4, 0.2, 0.1, 1], roughness: 1, metallic: 0, textureId: "tex_wood",
  }]);
  expect(svg).toContain("<polygon");
  expect(svg).toContain("等轴投影");
  expect(svg).not.toContain("tex_wood");
  expect((svg.match(/<polygon/g) ?? []).length).toBe(12);
});
