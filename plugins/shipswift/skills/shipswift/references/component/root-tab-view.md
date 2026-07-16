---
id: component-root-tab-view
title: Root Tab View
description: Root TabView template using iOS 18+ Tab API with selected/unselected icon switching and haptic feedback
tier: free
tags: [component, display, tabview, navigation, tab, iOS18, SwiftUI]
---

## Overview

Root TabView template using the iOS 18+ Tab API, with selected/unselected icon switching, native search tab, and haptic feedback. Uses `.environment(\.symbolVariants, .none)` to prevent the system from auto-filling icons.

## Source Code

```swift
import SwiftUI

struct SWRootTabView: View {
    @State private var selectedTab = "home"
    @State private var searchText = ""

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab(value: "home") {
                NavigationStack {
                    ScrollView {
                        ContentUnavailableView("Home", systemImage: "house.fill", description: Text("Your main feed and dashboard content goes here."))
                            .containerRelativeFrame(.vertical)
                    }
                    .navigationTitle("Home")
                }
            } label: {
                Label {
                    Text("Home")
                } icon: {
                    Image(systemName: selectedTab == "home" ? "house.fill" : "house")
                }
                .environment(\.symbolVariants, .none)
            }

            Tab(value: "outfit") {
                NavigationStack {
                    ScrollView {
                        ContentUnavailableView("Outfit", systemImage: "tshirt.fill", description: Text("Browse and manage your outfit collections here."))
                            .containerRelativeFrame(.vertical)
                    }
                    .navigationTitle("Outfit")
                }
            } label: {
                Label {
                    Text("Outfit")
                } icon: {
                    Image(systemName: selectedTab == "outfit" ? "tshirt.fill" : "tshirt")
                }
                .environment(\.symbolVariants, .none)
            }

            Tab(value: "setting") {
                NavigationStack {
                    ScrollView {
                        ContentUnavailableView("Settings", systemImage: "gearshape.fill", description: Text("Adjust preferences, account, and app configuration."))
                            .containerRelativeFrame(.vertical)
                    }
                    .navigationTitle("Setting")
                }
            } label: {
                Label {
                    Text("Setting")
                } icon: {
                    Image(systemName: selectedTab == "setting" ? "gearshape.fill" : "gearshape")
                }
                .environment(\.symbolVariants, .none)
            }

            Tab(value: "search") {
                NavigationStack {
                    ScrollView {
                        ContentUnavailableView.search(text: searchText)
                    }
                    .navigationTitle("Search")
                }
                .searchable(text: $searchText, prompt: "Search...")
            } label: {
                Label {
                    Text("Search")
                } icon: {
                    Image(systemName: "magnifyingglass")
                }
                .environment(\.symbolVariants, .none)
            }
        }
        .sensoryFeedback(.increase, trigger: selectedTab)
    }
}
```

## Usage

```swift
// Use directly as the app root view
@main struct MyApp: App {
    var body: some Scene {
        WindowGroup { SWRootTabView() }
    }
}

// Customize tabs: modify the Tab entries inside the TabView.
// Add or remove Tab entries freely. Set the selectedTab default
// value to the first tab's value string.
```
