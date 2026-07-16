---
id: component-image-thumbnail
title: Image Thumbnail
description: Reusable rounded image thumbnail with same-named ColorSet fallback — perfect for product cards, avatars, and cover images
tier: free
tags: [component, display, image, thumbnail, asset, SwiftUI]
---

## Overview

`SWImageThumbnail` is a square, rounded image tile designed for product cards, list rows, cart items, avatars, and cover headers -- anywhere a polished image preview is needed without writing bespoke loading-state UI.

**Killer feature -- same-name ColorSet as fallback.** The thumbnail expects your Asset Catalog to contain both an image set and a color set sharing the same name (e.g. `Drink_NaiCha` image + `Drink_NaiCha` color). `Color(imageName)` is rendered first as a solid background, and `Image(imageName)` is drawn on top with `.scaledToFill()`. As a result:

- If the image asset is missing or still decoding, the tile shows the brand-appropriate tint instead of a generic gray placeholder.
- If the image is partially transparent (e.g. a PNG with rounded edges), the tint fills the negative space.
- Empty / WIP states ship as a colored tile, not a broken-image icon.

If only an image (no matching color) is provided, SwiftUI silently falls back to clear -- the tile still renders correctly. The ColorSet is optional polish, not a hard requirement. This effectively eliminates blank-screen flashes during image load and turns missing assets into deliberate-looking colored placeholders.

## Source Code

```swift
//
//  SWImageThumbnail.swift
//  ShipSwift
//
//  Square image thumbnail with a same-named ColorSet fallback. Designed for
//  product cards, list rows, cart items, and detail headers where a polished
//  image tile is needed without bespoke loading-state UI.
//
//  Killer feature -- same-name ColorSet as fallback:
//    The thumbnail expects your Asset Catalog to contain both an image set and
//    a color set sharing the same name (e.g. `Drink_NaiCha` image + `Drink_NaiCha`
//    color). `Color(imageName)` is rendered first as a solid background, and
//    `Image(imageName)` is drawn on top with `.scaledToFill()`. As a result:
//
//      * If the image asset is missing or still decoding, the tile shows the
//        brand-appropriate tint instead of a generic gray placeholder.
//      * If the image is partially transparent (e.g. a PNG with rounded edges),
//        the tint fills the negative space.
//      * Empty / WIP states ship as a colored tile, not a broken-image icon.
//
//    If only an image (no matching color) is provided, SwiftUI silently falls
//    back to clear -- the tile still renders correctly. The ColorSet is optional
//    polish, not a hard requirement.
//
//  Usage:
//    // Basic -- 120pt square, 18pt corner radius
//    SWImageThumbnail(imageName: "Drink_NaiCha")
//
//    // Custom size and corner radius for cart rows
//    SWImageThumbnail(imageName: "Drink_YangZhi", size: 60, cornerRadius: 12)
//
//    // Large hero thumbnail
//    SWImageThumbnail(imageName: "Drink_KaoNai", size: 240, cornerRadius: 24)
//
//  Parameters:
//    - imageName: String         -- Asset catalog name. Looked up as both an
//                                   image set and (optionally) a color set.
//    - size: CGFloat             -- Tile width and height (default 120)
//    - cornerRadius: CGFloat     -- Continuous corner radius (default 18)
//
//  Created by Wei Zhong on 5/11/26.
//

import SwiftUI

struct SWImageThumbnail: View {
    // MARK: - Properties

    /// Asset catalog name used to look up both the image set and an optional
    /// same-named color set that serves as a fallback tint.
    let imageName: String

    /// Tile width and height. The thumbnail is always square.
    var size: CGFloat = 120

    /// Continuous corner radius applied to both the clip shape and the border.
    var cornerRadius: CGFloat = 18

    // MARK: - Body

    var body: some View {
        Color(imageName)
            .overlay(
                Image(imageName)
                    .resizable()
                    .scaledToFill()
            )
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(.white.opacity(0.18), lineWidth: 1)
            )
    }
}

// MARK: - Preview

#Preview {
    VStack(spacing: 16) {
        // Falls back to clear if neither image nor color is registered --
        // useful in previews where assets are not yet wired up.
        SWImageThumbnail(imageName: "PreviewMissingAsset")
        SWImageThumbnail(imageName: "PreviewMissingAsset", size: 80)
        SWImageThumbnail(imageName: "PreviewMissingAsset", size: 60, cornerRadius: 12)
    }
    .padding()
}
```

## Usage

```swift
// 1. Basic -- 120pt square, 18pt corner radius (defaults)
SWImageThumbnail(imageName: "Drink_NaiCha")

// 2. Compact list row thumbnail (cart rows, order rows)
HStack {
    SWImageThumbnail(imageName: item.imageName, size: 60, cornerRadius: 12)
    VStack(alignment: .leading) {
        Text(item.name)
        Text(item.price.formatted(.currency(code: "USD")))
    }
}

// 3. Large hero / detail header
SWImageThumbnail(imageName: "Drink_KaoNai", size: 240, cornerRadius: 24)

// 4. Asset Catalog setup for the ColorSet fallback
//    -- Add an image set named "Drink_NaiCha"
//    -- Add a color set named "Drink_NaiCha" (same name) with a brand-matched
//       tint that should appear during image load or when the asset is missing
//    -- Both can be edited independently and refreshed without code changes

// 5. Grid of product cards
LazyVGrid(columns: [GridItem(.adaptive(minimum: 120))], spacing: 16) {
    ForEach(products) { product in
        VStack {
            SWImageThumbnail(imageName: product.imageName)
            Text(product.name).font(.caption)
        }
    }
}
```
