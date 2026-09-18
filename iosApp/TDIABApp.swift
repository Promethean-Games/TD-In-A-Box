import SwiftUI

@main
struct TDIABApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    var body: some View {
        VStack {
            Text("TD in a Box")
                .font(.title)
            Text("iOS client scaffold")
                .foregroundStyle(.secondary)
        }
        .padding()
    }
}
