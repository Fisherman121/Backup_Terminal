const about_txt_content = `<viren-bahure>

    \\O_   This is me, viren bahure.
 ,/\\/     I am a student still learning.
   /      I also really love rainy weather.
   \\      And command line interfaces.
   \`      (because i like to feel cool)

</viren-bahure>`

const contact_txt = `E-Mail: viren.bahure@outlook.de`

let passwords_json = `{
    "google.com": "FAKE_PASSWORD",
    "github.com": "FAKE_PASSWORD",
    "die-quote.de": "FAKE_PASSWORD",
    "instagram.com": "FAKE_PASSWORD",
    "facebook.com": "FAKE_PASSWORD",
    "steam": "FAKE_PASSWORD"
}`

while (passwords_json.match(/FAKE_PASSWORD/)) {
    passwords_json = passwords_json.replace(/FAKE_PASSWORD/, function() {
        let chars = "zyxwvutsrqponmlkjihgfedcbaABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?@+-#"
        let tempPw = ""
        let len = Math.random() * 8 + 8
        for (let i = 0; i < len; i++) {
            tempPw += chars[Math.floor(Math.random() * chars.length)]
        }
        return tempPw
    }())
}

terminal.fileSystem.root = new DirectoryFile([
    new PlainTextFile(about_txt_content).setName("about.txt"),
    new DirectoryFile([
        new DirectoryFile([
            new PlainTextFile(passwords_json).setName("passwords.json")
        ]).setName("secret"),
        new PlainTextFile(contact_txt).setName("email.txt"),
    ]).setName("viren"),
    new PlainTextFile("https://github.com/viren-bahure/").setName("github.url"),
])