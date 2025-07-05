terminal.addCommand("helloworld", async function() {
    const printLinks = links => {
        for (const {name, url} of links) {
            terminal.printLink(name, url, undefined, false)
            terminal.print(" ")
        }
        terminal.print(" ")
    }

    const welcomeLineFuncs = [
        () => terminal.print("██    ██ ██ ██████  ███████ ███    ██ "),  
        () => terminal.print("██    ██ ██ ██   ██ ██      ████   ██ "),  
        () => terminal.print("██    ██ ██ ██████  █████   ██ ██  ██ "),  
        () => terminal.print(" ██  ██  ██ ██   ██ ██      ██  ██ ██ "),  
        () => terminal.print("  ████   ██ ██   ██ ███████ ██   ████ "),
        () => terminal.print("Welcome to my homepage. It's also a very interactive terminal.  "),
        () => terminal.print(`Enter commands to navigate over ${Object.keys(terminal.allCommands).length - 1} unique tools and features.  `),
        () => {
            terminal.print("Start your adventure using the ")
            terminal.printCommand("help", "help", undefined, false)
            terminal.print(" command. Have lots of fun!  ")
        },
        () => terminal.print("                                                                "),

        // --------------------------------------------------------------
        // Instagram GitHub Perli Library AntiCookieBox Stray GUI YouTube
        // Partycolo HR-Codes 3d Turtlo Coville Compli Spion Lettre Presi

        () => printLinks([
                {name: "Instagram", url: "https://instagram.com/viren.bahure/"},
                {name: "GitHub", url: "https://github.com/viren-bahure/terminal"},
                {name: "Perli", url: "https://viren-bahure.de/perli"},
                {name: "Library", url: "https://viren-bahure.de/lol"},
                {name: "AntiCookieBox", url: "https://viren-bahure.de/anticookiebox"},
                {name: "Stray", url: "https://viren-bahure.de/stray"},
                {name: "GUI", url: "https://viren-bahure.de/terminal/gui"},
                {name: "YouTube", url: "https://www.youtube.com/@viren.bahure"}
        ]),
        () => printLinks([
            {name: "Partycolo", url: "https://viren-bahure.de/partycolo"},
            {name: "HR-Codes", url: "https://viren-bahure.de/hr-code"},
            {name: "3d", url: "https://viren-bahure.de/3d"},
            {name: "Turtlo", url: "https://viren-bahure.de/turtlo"},
            {name: "Coville", url: "https://viren-bahure.de/coville"},
            {name: "Compli", url: "https://play.google.com/store/apps/details?id=de.virenbahure.compli"},
            {name: "Spion", url: "https://viren-bahure.de/spion"},
            {name: "Lettre", url: "https://viren-bahure.de/lettre"},
            {name: "Presi", url: "https://viren-bahure.de/presi"}
        ])
    ]

    let size = {
        x: welcomeLineFuncs.length * 2,
        y: welcomeLineFuncs.length
    }

    for (let i = 0; i < size.y; i++) {

        welcomeLineFuncs[i]()
        
        for (let j = 0; j < size.x; j++) {
            let x = (j / size.x - 0.5) * 2
            let y = (i / size.y - 0.5) * 2
            if (x*x + y*y > 1) {
                terminal.print(" ")
            } else {
                let angle = Math.atan2(y, x) / Math.PI * 180
                let hue = Math.round(angle)
                let lightness = Math.round(90 - (x*x + y*y) * 90)
                terminal.print("#", Color.hsl(hue / 360, 1, lightness / 100))
            }
        }
        terminal.addLineBreak()
    }
}, {
    description: "display the hello-world text",
    rawArgMode: true,
})