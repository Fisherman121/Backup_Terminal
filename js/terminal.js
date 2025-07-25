let uniqueFileIdCount = 0

const FileType = {
    RAW: "raw",
    DIRECTORY: "directory",
    PLAIN_TEXT: "plaintext",
    DATA_URL: "dataurl"
}

class FilePath {

    static from(obj) {
        if (typeof obj == "string") {
            return this.fromString(obj)
        } else if (obj instanceof FilePath) {
            return obj
        } else if (Array.isArray(obj)) {
            return new FilePath({items: obj})
        } else {
            return new Error(`Can't construct FilePath from "${typeof obj}"`)
        }
    }

    static fromString(str) {
        let parts = str.split(/[\\\/]/g).filter(part => part !== "")
        return new FilePath({items: parts})
    }

    constructor({
        items = [],
        relativeTo = null,
    }={}) {
        this.items = items
        this.relativeTo = relativeTo
    }

    prependFile(file) {
        this.items.unshift(file.name)
    }

    addFile(file) {
        this.items.push(file.name)
    }

    prependItem(str) {
        this.items.unshift(str)
    }

    addItem(str) {
        this.items.push(str)
    }

    pop() {
        return this.files.pop()
    }

    concat(otherFilePath) {
        return new FilePath({items: this.items.concat(otherFilePath.items)})
    }

    get isFilePath() {
        return true
    }

    slice(start, end) {
        return new FilePath({items: this.items.slice(start, end)})
    }

    fromRoot() {
        if (this.relativeTo == null) {
            return this
        } else {
            return this.relativeTo.path.fromRoot().concat(this)
        }
    }

    toString() {
        if (this.relativeTo == null) {
            if (this.items[0] === "root") {
                return this.items.join("/") + "/"
            } else {
                return "root/" + this.items.join("/") + "/"
            }
        } else {
            return this.fromRoot().toString()
        }
    }

    get length() {
        return this.items.length
    }

}

class TerminalFile {

    static classFromType(type) {
        switch (type) {
            case FileType.RAW:
                return TerminalFile
            case FileType.DIRECTORY:
                return DirectoryFile
            case FileType.PLAIN_TEXT:
            case "text": // compatability
            case "executable": // same here
                return PlainTextFile
            case FileType.DATA_URL:
                return DataURLFile
            default:
                throw new Error("Unknown Filetype: " + type)
        }
    }

    constructor(content) {
        this.type = FileType.RAW
        this.content = content
        this.parent = null
        this.id = uniqueFileIdCount++
        this.name = `unnamed-${this.id}`
    }

    setName(name) {
        this.name = name
        return this
    }

    computeSize() {
        return JSON.stringify(this.toObject()).length
    }

    copy() {
        return TerminalFile.fromObject(this.toObject())
    }

    get path() {
        return new FilePath({relativeTo: this.parent, items: [this.name]})
    }

    toObject() {
        return {
            name: this.name,
            type: this.type,
            content: this.content
        }
    }

    static fromObject(obj) {
        let children = []
        let content = obj.content
        if (obj.type === "directory") {
            // compatability with previous versions of filesystem saving
            // that may still exist in some peoples localstorage!
            if (typeof obj.content == "object" && obj.content !== null && !Array.isArray(obj.content)) {
                obj.content = Object.entries(obj.content).map(([fname, fobj]) => {
                    fobj.name = fname
                    return fobj
                })
            }

            children = obj.content.map(c => TerminalFile.fromObject(c))
            content = children
        }

        const file = new (TerminalFile.classFromType(obj.type))(content)
        for (let child of children) {
            child.parent = file
        }

        if (obj.name) {
            file.name = obj.name
        }

        return file
    }

}

class PlainTextFile extends TerminalFile {

    constructor(content) {
        content ??= ""
        super(content)
        this.type = FileType.PLAIN_TEXT
    }

    get text() {
        return this.content
    }

    set text(newText) {
        this.content = newText
    }

    append(text) {
        this.content += text
    }

    write(text) {
        this.content = text
    }

    get isPlainText() {
        return true
    }

}

class DataURLFile extends TerminalFile {

    constructor(content) {
        content ??= ""
        super(content)
        this.type = FileType.DATA_URL
    }

    get dataUrl() {
        return this.content
    }

    set dataUrl(newUrl) {
        this.content = newUrl
    }

    get isDataUrl() {
        return true
    }

}

class DirectoryFile extends TerminalFile {

    constructor(content) {
        content ??= []
        super(content)
        this.type = FileType.DIRECTORY
    }

    get children() {
        return this.content
    }

    toObject() {
        return {
            type: this.type,
            name: this.name,
            content: this.children.map(file => file.toObject()),
        }
    }

    addChild(child) {
        this.content.push(child)
        child.parent = this
    }

    deleteChild(child) {
        this.content = this.children.filter(f => f.id != child.id)
    }

    fileExists(path) {
        return !!this.getFile(path)
    }

    findChildByName(name) {
        return this.children.find(c => c.name == name)
    }

    getFile(path) {
        path = FilePath.from(path)
        let currDirectory = this

        for (let name of path.items) {
            let child = undefined

            if (name == ".") {
                continue
            } else if (name == "..") {
                if (!currDirectory.parent) {
                    return undefined
                } else {
                    currDirectory = currDirectory.parent
                }
            } else if (name == "~") {
                while (currDirectory.parent) {
                    currDirectory = currDirectory.parent
                }
            } else {
                child = currDirectory.findChildByName(name)
                if (!child) {
                    return undefined
                }
                currDirectory = child
            }
        }
        
        return currDirectory
    }

    get allChildren() {
        let files = []
        let stack = [this]
        while (stack.length > 0) {
            let file = stack.pop()
            files.push(file)
            if (file.isDirectory) {
                stack.push(...file.children)
            }
        }
        return files
    }

    get isDirectory() {
        return true
    }

}

class FileSystem {

    constructor() {
        this.root = new DirectoryFile().setName("root")
        this.currDirectory = this.root

        // in session mode, changes don't get saved to local storage
        this.inSessionMode = false
    }

    get pathStr() {
        return this.currDirectory.path.toString()
    }

    get path() {
        return this.currDirectory.path.fromRoot()
    }

    allFiles() {
        return this.root.allChildren
    }

    getFile(path) {
        path = FilePath.from(path)
        if (path.items[0] == "root") {
            return this.root.getFile(path.slice(1))
        } else {
            return this.currDirectory.getFile(path)
        }
    }

    fileExists(path) {
        return !!this.getFile(path)
    }

    filesizeStr(numBytes) {
        if (numBytes < 1e3 ) return `${numBytes} Bytes`
        if (numBytes < 1e6 ) return `${Math.round(numBytes / 1e3 * 10) / 10} KB`
        if (numBytes < 1e9 ) return `${Math.floor(numBytes / 1e6 * 10) / 10} MB`
        if (numBytes < 1e12) return `${Math.floor(numBytes / 1e9 * 10) / 10} GB`
        return `${Math.floor(numBytes / 1e12 * 10 / 10)} TB`
    }

    dumpTooLargeFiles(file, fileSizeLimit) {
        if (file.computeSize() < fileSizeLimit) {
            return
        }

        let allFiles = []
        function getAllFiles(file) {
            allFiles.push(file)
            if (file.isDirectory) {
                for (let [key, value] of Object.entries(file.content)) {
                    getAllFiles(value)
                }
            }
        }

        getAllFiles(file)

        let introducedDumping = false
        function introduceDumping() {
            if (introducedDumping)
                return
            introducedDumping = true

            terminal.printError("Storage limit exceeded!")
            terminal.printLine("I will now delete the largest files to free up space:")
        }

        function dumpLargestFile() {
            let largestFile = null
            let largestSize = 0
            for (let file of allFiles) {
                if (file.isDirectory)
                    continue
                const size = file.computeSize()
                if (size > largestSize) {
                    largestFile = file
                    largestSize = size
                }
            }
            if (largestFile && largestFile.parent) {
                largestFile.parent.deleteChild(largestFile)
                introduceDumping()
                terminal.printLine(`- ${largestFile.path} (${terminal.fileSystem.filesizeStr(largestFile.computeSize())})`)
                allFiles = allFiles.filter(file => file.id !== largestFile.id)
            } else if (largestFile) {
                return "not ready yet"
            }
        }

        let totalSize = file.computeSize()
        while (totalSize > fileSizeLimit) {
            if (dumpLargestFile() === "not ready yet")
                break
            totalSize = file.computeSize()
        }

        if (introducedDumping)
            terminal.printLine("")
    }

    toJSON() {
        if (!this.inSessionMode) {
            let fileSizeLimit = terminal.data.storageSize
            this.dumpTooLargeFiles(this.root, fileSizeLimit)
        }
        return JSON.stringify(this.root.toObject())
    }

    loadJSON(jsonString) {
        let parsed = JSON.parse(jsonString)
        this.root = TerminalFile.fromObject(parsed).setName("root")
        this.currDirectory = this.root
    }

    reset() {
        if (!this.inSessionMode) {
            localStorage.removeItem("terminal-filesystem")
        }

        this.root = new DirectoryFile().setName("root")
        this.currDirectory = this.root
    }

    beginSession() {
        this.inSessionMode = true
    }

    endSession() {
        this.inSessionMode = false
    }

    save() {
        if (this.inSessionMode) {
            return
        }

        localStorage.setItem("terminal-filesystem", this.toJSON())
    }

    async load(jsonVal=undefined) {
        if (this.inSessionMode) {
            return
        }

        let json = jsonVal ?? localStorage.getItem("terminal-filesystem")
        if (json) {
            this.loadJSON(json)
        } else {
            await terminal._loadScript(terminal.defaultFileystemURL)
            this.save()
            this.loadJSON(this.toJSON())
        }
    }

    async reload() {
        this.save()
        await this.load()
    }

    saveTemp() {
        this.tempSave = this.toJSON()
    }

    async restoreTemp() {
        if (!this.tempSave) {
            throw new Error("no save to restore found")
        }
        await this.load(this.tempSave)
    }

}

class TerminalData {

    defaultValues = {
        "background": "#030306",
        "foreground": "#ffffff",
        "font": "\"Cascadia Code\", monospace",
        "accentColor1": "#ffff00",
        "accentColor2": "#8bc34a",
        "history": "[]",
        "storageSize": "1000000",
        "startupCommands": "[\"helloworld\"]",
        "mobile": "2",
        "easterEggs": "[]",
        "maxHistoryLength": "100",
        "sidepanel": "true",
        "path": "[]",
        "aliases": '{"tree": "ls -r","github": "href -f root/github.url","hugeturtlo": "turtlo --size 2","hugehugeturtlo": "turtlo --size 3"}'
    }

    localStoragePrepend = "terminal-"

    getDefault(key) {
        return this.defaultValues[key]
    }

    get(key, defaultValue) {
        if (!defaultValue) defaultValue = this.getDefault(key)
        return localStorage.getItem(this.localStoragePrepend + key) ?? defaultValue
    }

    set(key, value) {
        localStorage.setItem(this.localStoragePrepend + key, value)
    }

    getCSSProperty(key) {
        let value = document.documentElement.style.getPropertyValue(key)
        if (!value) value = this.get(key)
        return value
    }

    setCSSProperty(key, value) {
        document.documentElement.style.setProperty(key, value)
    }

    get background() {
        return Color.fromHex(this.get("background"))
    }

    set background(color) {
        this.set("background", color.string.hex)
        this.setCSSProperty("--background", color.string.hex)
    }

    get foreground() {
        return Color.fromHex(this.get("foreground"))
    }

    set foreground(color) {
        this.set("foreground", color.string.hex)
        this.setCSSProperty("--foreground", color.string.hex)
    }

    get font() {
        return this.get("font")
    }

    set font(font) {
        this.set("font", font)
        this.setCSSProperty("--font", font)
    }

    get accentColor1() {
        return Color.fromHex(this.get("accentColor1"))
    }

    set accentColor1(color) {
        this.set("accentColor1", color.string.hex)
        this.setCSSProperty("--accent-color-1", color.string.hex)
    }

    get accentColor2() {
        return Color.fromHex(this.get("accentColor2"))
    }

    set accentColor2(color) {
        this.set("accentColor2", color.string.hex)
        this.setCSSProperty("--accent-color-2", color.string.hex)
    }

    get history() {
        return JSON.parse(this.get("history"))
    }

    set history(history) {
        this.set("history", JSON.stringify(history))
    }

    get path() {
        return JSON.parse(this.get("path"))
    }
    
    set path(path) {
        this.set("path", JSON.stringify(path))
    }

    get easterEggs() {
        let arr = JSON.parse(this.get("easterEggs"))
        return new Set(arr)
    }

    set easterEggs(newEasterEggs) {
        let arr = Array.from(newEasterEggs)
        this.set("easterEggs", JSON.stringify(arr))
    }

    get aliases() {
        return JSON.parse(this.get("aliases"))
    }

    set aliases(newAliases) {
        this.set("aliases", JSON.stringify(newAliases))
    }

    addAlias(alias, command) {
        let aliases = this.aliases
        aliases[alias] = command
        this.aliases = aliases
    }

    removeAlias(alias) {
        let aliases = this.aliases
        delete aliases[alias]
        this.aliases = aliases
    }

    addEasterEgg(easterEggID) {
        let foundEggs = this.easterEggs
        foundEggs.add(easterEggID)
        this.easterEggs = foundEggs
    }
    
    get mobile() {
        let value = this.get("mobile")
        if (value === "0") return undefined
        if (value === "1") return true
        if (value === "2") return false
        return null
    }

    set mobile(mobile) {
        if (mobile === undefined) mobile = "0"
        if (mobile === true) mobile = "1"
        if (mobile === false) mobile = "2"
        this.set("mobile", mobile)
    }

    get sidepanel() {
        return this.get("sidepanel") === "true"
    }

    set sidepanel(sidepanel) {
        this.set("sidepanel", sidepanel.toString())
    }

    get storageSize() {
        return parseInt(this.get("storageSize"))
    }

    set storageSize(size) {
        this.set("storageSize", size)
    }

    get maxHistoryLength() {
        return parseInt(this.get("maxHistoryLength"))
    }

    set maxHistoryLength(length) {
        this.set("maxHistoryLength", length)
    }

    get lastItemOfHistory() {
        return this.history[this.history.length - 1]
    }

    get startupCommands() {
        return JSON.parse(this.get("startupCommands"))
    }

    set startupCommands(commands) {
        this.set("startupCommands", JSON.stringify(commands))
    }

    addToHistory(command) {
        let history = this.history
        let lastItem = history[history.length - 1]
        if (lastItem == command) return
        history.push(command)
        if (history.length > this.maxHistoryLength) {
            history.shift()
        }
        this.history = history
    }

    constructor() {
        this.background = this.background
        this.foreground = this.foreground
        this.font = this.font
        this.accentColor1 = this.accentColor1
        this.accentColor2 = this.accentColor2
        this.mobile = this.mobile
    }

    resetProperty(key) {
        this.set(key, this.getDefault(key))
        this[key] = this[key]
    }

    resetAll() {
        for (let key in this.defaultValues) {
            this.set(key, this.defaultValues[key])
        }
    }

}

class Color {

    constructor(r, g, b, a) {
        this.r = r
        this.g = g
        this.b = b
        this.a = a ?? 1
    }

    static fromHex(hex) {
        if (!hex.startsWith("#"))
            hex = "#" + hex
        let r = parseInt(hex.substring(1, 3), 16)
        let g = parseInt(hex.substring(3, 5), 16)
        let b = parseInt(hex.substring(5, 7), 16)
        return new Color(r, g, b)
    }

    static fromHSL(h, s, l) {
        let r, g, b
        if (s == 0) {
            r = g = b = l
        } else {
            let hue2rgb = function hue2rgb(p, q, t) {
                if (t < 0) t += 1
                if (t > 1) t -= 1
                if (t < 1/6) return p + (q - p) * 6 * t
                if (t < 1/2) return q
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
                return p
            }
            let q = l < 0.5 ? l * (1 + s) : l + s - l * s
            let p = 2 * l - q
            r = hue2rgb(p, q, h + 1/3)
            g = hue2rgb(p, q, h)
            b = hue2rgb(p, q, h - 1/3)
        }
        return new Color(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255))
    }

    static hsl(h, s, l) {
        return Color.fromHSL(h, s, l)
    }

    static hsla(h, s, l, a) {
        let color = Color.fromHSL(h, s, l)
        color.a = a
        return color
    }

    static hex(hex) {
        return Color.fromHex(hex)
    }

    static rgb(r, g, b) {
        return new Color(r, g, b)
    }

    static niceRandom() {
        const f = () => Math.floor(Math.random() * 100) + 150
        return new Color(f(), f(), f())
    }

    static random() {
        const f = () => Math.floor(Math.random() * 255)
        return new Color(f(), f(), f())
    }

    eq(color) {
        return this.r == color.r && this.g == color.g && this.b == color.b && this.a == color.a
    }

    equals(color) {
        return this.eq(color)
    }

    distanceTo(color) {
        let r = this.r - color.r
        let g = this.g - color.g
        let b = this.b - color.b
        let a = this.a - color.a
        return Math.sqrt(r * r + g * g + b * b + a * a)
    }

    get hsl() {

        let h = 0
        let s = 0
        let l = 0

        let r = this.r / 255
        let g = this.g / 255
        let b = this.b / 255

        let max = Math.max(r, g, b)
        let min = Math.min(r, g, b)

        if (max == min) h = 0
        else if (max == r) h = 60 * ((g - b) / (max - min))
        else if (max == g) h = 60 * (2 + (b - r) / (max - min))
        else if (max == b) h = 60 * (4 + (r - g) / (max - min))

        if (h < 0) h += 360

        l = (max + min) / 2
        
        if (max == min) s = 0
        else if (l <= 0.5) s = (max - min) / (max + min)
        else if (l > 0.5) s = (max - min) / (2 - max - min)

        return {
            h: h,
            s: s,
            l: l
        }

    }

    get string() {
        let self = this
        return {
            get rgb() {
                return `rgb(${self.r}, ${self.g}, ${self.b})`
            },

            get rgba() {
                return `rgba(${self.r}, ${self.g}, ${self.b}, ${self.a})`
            },

            get hex() {
                let r = self.r.toString(16).padStart(2, "0")
                let g = self.g.toString(16).padStart(2, "0")
                let b = self.b.toString(16).padStart(2, "0")
                return `#${r}${g}${b}`
            },

            get hsl() {
                let h = self.hsl.h
                let s = self.hsl.s * 100
                let l = self.hsl.l * 100
                return `hsl(${h}, ${s}%, ${l}%)`
            }

        }
    }

    toString() {
        return this.string.rgba
    }

    static get COLOR_1() {
        return terminal.data.accentColor1
    }

    static get COLOR_2() {
        return terminal.data.accentColor2
    }

    static get WHITE() {return new Color(255, 255, 255)}
    static get BLACK() {return new Color(0, 0, 0)}
    static get LIGHT_GREEN() {return new Color(0, 255, 0)}
    static get PURPLE() {return new Color(79, 79, 192)}
    static get ERROR() {return new Color(255, 128, 128)}

}

class IntendedError extends Error {
    constructor(message) {
        super(message)
        this.name = "IntendedError"
    }
}

class DeveloperError extends Error {
    constructor(message) {
        super(message)
        this.name = "DeveloperError"
    }
}

class ParserError extends Error {
    constructor(message) {
        super(message)
        this.name = "ParserError"
    }
}

class TerminalParser {

    static isVariable = (token) => /^\$[a-zA-Z][a-zA-Z0-9]*$/.test(token)
    static commandIsAssignment = (command) => /^\$[a-zA-Z][a-zA-Z0-9]*\s*=/.test(command)
    static extractVariableName = (command) => command.match(/^\$([a-zA-Z][a-zA-Z0-9]*)\s*=/)[1]

    static replaceVariables(tokens, variables) {
        return tokens.map(token => {
            if (this.isVariable(token)) {
                let name = this.extractVariableName(token + "=")
                if (name in variables) return variables[name]
            }
            return token
        })
    }
    
    static extractAssignment(command) {
        if (!TerminalParser.commandIsAssignment(command)) return null

        let variableName = TerminalParser.extractVariableName(command)
        let variableValue = command.split("=", 2)[1]
        return {
            name: variableName,
            value: variableValue
        }
    }

    static tokenize(input) {
        let tokens = []
        let tempToken = ""

        let apostropheCharacters = ["'", '"']
        let spaceCharacters = [" ", "\t", "\n"]

        let activeApostrophe = null

        for (let char of input) {
            if (activeApostrophe) {
                if (char == activeApostrophe) {
                    tokens.push(tempToken)
                    tempToken = ""
                    activeApostrophe = null
                } else {
                    tempToken += char
                }
            } else if (apostropheCharacters.includes(char)) {
                activeApostrophe = char
            } else if (spaceCharacters.includes(char)) {
                if (tempToken != "") {
                    tokens.push(tempToken)
                    tempToken = ""
                }
            } else {
                tempToken += char
            }
        }

        if (tempToken != "")
            tokens.push(tempToken)

        return tokens
    }

    static extractCommandAndArgs(tokens) {
        let args = [...tokens]
        let command = args[0]
        args.shift()
        return [command, args]
    }

    static parseArgOptions(argString) {
        // ?a is an optional argument
        // a is a required argument
        // abc is a required argument
        // ?abc is an optional argument
        // a:n is a required argument that is a number
        // ?a:n is an optional argument that is a number
        // a:n:1~100 is a required argument that is a number between 1 and 100
        // ?a:n:1~100 is an optional argument that is a number between 1 and 100
        // *a is a required argument that is a string and expands to the rest of the arguments
        // ?*a is an optional argument that is a string and expands to the rest of the arguments
        // a:b is a required argument that is a boolean

        let argOptions = {
            name: null,
            type: "string",
            typeName: "string",
            stringType: null,
            optional: false,
            min: null,
            max: null,
            expanding: false,
            numtype: undefined,
            default: undefined,
            forms: [],
            get fullName() {
                if (this.forms.length > 0)
                    return this.forms.join("|")
                return this.name
            },
            isHelp: false,
            description: ""
        }

        let name = argString

        if (name.startsWith("?")) {
            argOptions.optional = true
            name = name.substring(1)
        }

        if (name.startsWith("*")) {
            argOptions.expanding = true
            name = name.substring(1)
        }

        if (name.includes(":")) {
            let parts = name.split(":")
            name = parts[0]
            let type = parts[1]
            if (type == "n") {
                argOptions.type = argOptions.typeName = "number"
            } else if (type == "i") {
                argOptions.type = "number"
                argOptions.typeName = "integer"
                argOptions.numtype = "integer"
            } else if (type == "bn") {
                argOptions.type = "bigint"
                argOptions.typeName = "integer"
            } else if (type == "b") {
                argOptions.type = argOptions.typeName = "boolean"
            } else if (type == "s") {
                argOptions.type = argOptions.typeName = "string"
            } else if (type == "f") {
                argOptions.type = argOptions.typeName = "file"
            } else if (type == "c") {
                argOptions.type = argOptions.typeName = "command"
            } else if (type == "sm") {
                argOptions.type = argOptions.typeName = "square-matrix"
            } else if (type == "m") {
                argOptions.type = argOptions.typeName = "matrix"
            } else if (type == "e") {
                argOptions.type = argOptions.typeName = "enum"
            } else if (type == "t") {
                argOptions.type = argOptions.typeName = "string"
                argOptions.stringType = "text"
            } else {
                throw new DeveloperError(`Invalid argument type: ${type}`)
            }

            if (parts.length > 2) {
                if (argOptions.type == "number") {
                    let range = parts[2]
                    if (range.includes("~")) {
                        let rangeParts = range.split("~")
                        argOptions.min = parseFloat(rangeParts[0])
                        argOptions.max = parseFloat(rangeParts[1])
                    } else {
                        argOptions.min = parseFloat(range)
                        argOptions.max = parseFloat(range)
                    }
                } else if (argOptions.type == "enum") {
                    argOptions.enumOptions = parts[2].split("|")
                }
            }
        }

        argOptions.name = name
        argOptions.forms = [name]
        argOptions.description = ""
        argOptions.error = undefined
        argOptions.tokenIndex = undefined
        argOptions.tokenSpan = 0
        argOptions.value = undefined
        argOptions.isManuallySetValue = false

        if (argOptions.name.includes("=")) {
            argOptions.forms = argOptions.name.split("=")
            argOptions.name = argOptions.forms[1]
        }

        if (argOptions.name == "help" || argOptions.name == "h") {
            argOptions.isHelp = true
        }

        return argOptions
    }

    static getArgOption(argOptions, argName) {
        return argOptions.find(arg => arg.name == argName || arg.forms.includes(argName))
    }

    static parseNamedArgs(tokens, argOptions, parsingError) {
        let deleteIndeces = []

        for (let i = 0; i < tokens.length; i++) {
            let currToken = tokens[i]
            let nextToken = tokens[i + 1]
            let deleteNext = true

            const handleArg = name => {
                let argOption = this.getArgOption(argOptions, name)

                if (!argOption) {
                    parsingError.message = `Unexpected property "${name}"`
                    parsingError.tokenIndex = i
                } else if (!argOption.optional) {
                    argOption.tokenIndex = i
                    parsingError.message = `Property "${argOption.name}" is not optional, must be passed directly`
                    parsingError.tokenIndex = i
                    parsingError.tokenSpan = 1
                } else if (argOption.type == "boolean") {
                    argOption.tokenIndex = i
                    this._parseArgumentValue(argOption, true, parsingError)
                    deleteNext = false
                } else {
                    if (nextToken) {
                        argOption.tokenIndex = i
                        argOption.tokenSpan = 1
                        this._parseArgumentValue(argOption, nextToken, parsingError)
                    } else {
                        parsingError.message = `property "${argOption.name}" (${argOption.typeName}) expects a value`
                        parsingError.tokenIndex = i + 1
                    }
                }
            }

            if (currToken.match(/^--?[a-zA-Z][a-zA-Z0-9:_\-:.]*$/g)) {
                if (currToken.startsWith("--")) {
                    let name = currToken.slice(2)
                    handleArg(name)
                } else if (currToken.length == 2) {
                    let name = currToken.slice(1)
                    handleArg(name)
                } else {
                    for (let j = 0; j < currToken.length; j++) {
                        let char = currToken[j]
                        let argOption = this.getArgOption(argOptions, char)
                        if (char == "-") continue
                        if (argOption) {
                            argOption.tokenIndex = i
                            this._parseArgumentValue(argOption, true, parsingError)
                        }
                        if (j == currToken.length - 1) {
                            handleArg(char)
                        } else {
                            if (!argOption) {
                                parsingError.message = `Unexpected property "${char}"`
                                parsingError.tokenIndex = i
                            } else if (argOption.type != "boolean") {
                                parsingError.message = `Property "${char}" is not a boolean and must be assigned a value`
                                parsingError.tokenIndex = i
                            }
                        }

                        if (parsingError.message) return null
                    }
                }

                deleteIndeces.push(i)
                if (deleteNext)
                    deleteIndeces.push(i + 1)
            }

            if (parsingError.message) return null
        }

        return deleteIndeces
    }

    static _parseNumber(numberString, argOption, error) {
        // GRAMMAR:
        // number: "-" number | decimal | number "/" number | "0x" hexint | "0x" hexdecimal |
        //         "0b" binint | "0b" bindecimal | "sqrt(" number ")" |
        //         "sin(" number ")" | "cos(" number ")" | "tan(" number ")" |
        //         decimal "e" int | "pi" | "tau" | "phi" | "e" |
        //         number "*" number | number "^" number | number "-" number | number "+" number
        // decimal: int | int "." int
        // int: "0" int | ... | "9" int | "0" | ... | "9"
        // hexdecimal: hexint | hexint "." hexint
        // hexint: "0" hexint | ... | "f" hexint | "0" | ... | "f"
        // bindecimal: binint | binint "." binint
        // binint: "0" binint | "1" binint | "0" | "1"

        const constants = {
            "pi": Math.PI,
            "tau": 2 * Math.PI,
            "phi": (1 + Math.sqrt(5)) / 2,
            "e": Math.E
        }

        for (const [constant, value] of Object.entries(constants)) {
            if (numberString == constant) {
                return value
            }
        }

        if (numberString == "inf") {
            return error(`At property "${argOption.name}": Infinity is not a number`)
        }

        const decimalRegex = /^[0123456789]+\.[0123456789]+$/
        const intRegex = /^[0123456789]+$/
        const hexDecimalRegex = /^0x[0123456789abcdef]+\.[0123456789abcdef]+$/
        const hexIntRegex = /^0x[0123456789abcdef]+$/
        const binDecimalRegex = /^0b[01]+\.[01]+$/
        const binIntRegex = /^0b[01]+$/
        const scientificRegex = /^\-?[0123456789]+(\.[0123456789]+)?e[0123456789]+$/

        if (numberString.startsWith("-")) {
            const value = this._parseNumber(numberString.slice(1), argOption, error)
            if (value == ParserError) {
                return value
            } else {
                return -value
            }
        }

        const allowedFunctions = {
            "sqrt": {
                compute: n => Math.sqrt(n),
                constraints: [
                    {
                        if: n => (n < 0),
                        err: () => error(`At property "${argOption.name}": sqrt is only defined on [0, inf)`)
                    }
                ]
            },
            "sin":     {compute: n => Math.sin(n)},
            "cos":     {compute: n => Math.cos(n)},
            "tan":     {compute: n => Math.tan(n)},
            "arcsin":  {
                compute: n => Math.asin(n),
                constraints: [
                    {
                        if: n => (n < -1) || (n > 1),
                        err: () => error(`At property "${argOption.name}": arcsin is only defined on [-1, 1]`)
                    }
                ]
            },
            "arccos":  {
                compute: n => Math.acos(n),
                constraints: [
                    {
                        if: n => (n < -1) || (n > 1),
                        err: () => error(`At property "${argOption.name}": arccos is only defined on [-1, 1]`)
                    }
                ]
            },
            "arctan":  {compute: n => Math.atan(n)},
            "sinh":    {compute: n => Math.sinh(n)},
            "cosh":    {compute: n => Math.cosh(n)},
            "tanh":    {compute: n => Math.tanh(n)},
            "arcsinh": {compute: n => Math.asinh(n)},
            "arccosh": {
                compute: n => Math.acosh(n),
                constraints: [
                    {
                        if: n => (n < 1),
                        err: () => error(`At property "${argOption.name}": arccosh is only defined on [1, inf)`)
                    }
                ]
            },
            "arctanh": {
                compute: n => Math.atanh(n),
                constraints: [
                    {
                        if: n => (n <= -1) || (n >= 1),
                        err: () => error(`At property "${argOption.name}": arctanh is only defined on (-1, 1)`)
                    }
                ]
            },
            "": {compute: n => n}
        }

        for (const [functionStr, func] of Object.entries(allowedFunctions)) {
            if (numberString.startsWith(`${functionStr}(`)) {
                // if we find that we closing bracket doesn't belong to opening bracket, abort
                const numberPart = numberString.slice(functionStr.length + 1, -1)
                let openCount = 0
                let abortThisExecution = false
                for (const char of numberPart) {
                    if (char == "(") {
                        openCount++
                    } else if (char == ")") {
                        openCount--
                    }
                    if (openCount < 0) {
                        abortThisExecution = true
                        break
                    }
                }
                if (abortThisExecution) {
                    continue
                }

                const value = this._parseNumber(numberPart, argOption, error)
                if (value == ParserError) return value
                for (const constraint of (func.constraints ?? [])) {
                    if (constraint.if(value)) {
                        return constraint.err()
                    }
                }
                return func.compute(value)
            }
        }

        if (intRegex.test(numberString)) {
            return parseInt(numberString)
        } else if (hexIntRegex.test(numberString)) {
            return parseInt(numberString.slice(2), 16)
        } else if (binIntRegex.test(numberString)) {
            return parseInt(numberString.slice(2), 2)
        }

        if (decimalRegex.test(numberString)) {
            return parseFloat(numberString)
        } else if (binDecimalRegex.test(numberString)) {
            const [before, after] = numberString.split(".")
            const beforeVal = parseInt(before.slice(2), 2)
            const afterVal = parseInt(after, 2)
            return beforeVal + afterVal / (2 ** after.length)
        } else if (hexDecimalRegex.test(numberString)) {
            const [before, after] = numberString.split(".")
            const beforeVal = parseInt(before.slice(2), 16)
            const afterVal = parseInt(after, 16)
            return beforeVal + afterVal / (16 ** after.length)
        }

        if (scientificRegex.test(numberString)) {
            let [decimal, exponent] = numberString.split("e")
            decimal = parseFloat(decimal)
            exponent = parseInt(exponent)
            return decimal * (10 ** exponent)
        }

        // in list of anti-precedence
        const operators = [
            ["+", (a, b) => a + b],
            ["-", (a, b) => a - b],
            ["*", (a, b) => a * b],
            ["/", (a, b) => a / b],
            ["^", (a, b) => a ** b],
        ]

        for (const [operatorName, operatorFunc] of operators) {
            let currLevel = 0
            let foundSplitIndex = null
            for (let i = 0; i < numberString.length; i++) {
                const char = numberString[i]
                if (char == "(") currLevel++
                if (char == ")") currLevel--
                if (currLevel < 0) {
                    return error(`At property "${argOption.name}": Unbalanced parentheses`)
                }
                if (char == operatorName && currLevel == 0) {
                    foundSplitIndex = i
                }
            }

            if (currLevel != 0) {
                return error(`At property "${argOption.name}": Unbalanced parentheses`)
            }

            if (foundSplitIndex === null) {
                continue
            }

            // split into two parts only
            const parts = [
                numberString.slice(0, foundSplitIndex),
                numberString.slice(foundSplitIndex + 1)
            ]

            for (let i = 0; i < 2; i++) {
                parts[i] = this._parseNumber(parts[i], argOption, error)
                if (parts[i] == ParserError) {
                    return parts[i]
                }
            }

            if (parts[1] == 0 && operatorName == "/") {
                return error(`At property "${argOption.name}": Can't divide by zero`)
            }

            return operatorFunc(parts[0], parts[1])
        }

        return error(`At property "${argOption.name}": Invalid number`)
    }

    static _parseArgumentValue(argOption, value, parsingError) {
        function addVal(value) {
            if (argOption.expanding && argOption.value) {
                value = argOption.value + " " + value
            }
            argOption.value = value
            argOption.isManuallySetValue = true
        }

        const error = msg => {
            parsingError.message = msg
            parsingError.tokenIndex = argOption.tokenIndex
            parsingError.tokenSpan = argOption.tokenSpan
            return ParserError
        }

        if (argOption.type == "number") {
            let num = this._parseNumber(value, argOption, error)
            if (num == ParserError) {
                return num
            }

            if (!Number.isFinite(num)) {
                return error(`At property "${argOption.name}": Infinity isn't a number`)
            } else if (Number.isNaN(num)) {
                return error(`At property "${argOption.name}": Not a number`)
            }

            if (argOption.numtype == "integer") {
                if (!Number.isInteger(num)) {
                    return error(`At property "${argOption.name}": Expected an integer`)
                }
            }

            if (argOption.min != null && num < argOption.min) {
                return error(`At property "${argOption.name}": Number must be at least ${argOption.min}`)
            }

            if (argOption.max != null && num > argOption.max) {
                return error(`At property "${argOption.name}": Number must be at most ${argOption.max}`)
            }

            addVal(num)
        } else if (argOption.type == "boolean") {
            const trueForms = ["true", true, "1"]
            const falseForms = ["false", false, "0"]
            if (!trueForms.concat(falseForms).includes(value)) {
                return error(`At property "${argOption.name}": Expected a boolean`)
            }
            addVal(trueForms.includes(value))
        } else if (argOption.type == "bigint") {
            try {
                addVal(BigInt(value))
            } catch {
                return error(`At property "${argOption.name}": Expected an integer`)
            }
        } else if (argOption.type == "file") {
            if (!terminal.fileExists(value)) {
                return error(`File not found: "${value}"`)
            }
            addVal(value)
        } else if (argOption.type == "command") {
            if (!terminal.commandExists(value)) {
                return error(`Command not found: "${value}"`)
            }
            addVal(value)
        } else if (argOption.type == "enum") {
            if (!argOption.enumOptions.includes(value)) {
                return error(`Invalid Option: "${value}"`)
            }
            addVal(value)
        } else if (argOption.type == "matrix" || argOption.type == "square-matrix") {
            // please consider me a regex god for this:
            // (matches any valid matrices)
            if (!/^\[((-?[0-9]+(\.[0-9]+)?)|[a-z])(\,((-?[0-9]+(\.[0-9]+)?)|[a-z]))*(\/((-?[0-9]+(\.[0-9]+)?)|[a-z])(\,((-?[0-9]+(\.[0-9]+)?)|[a-z]))*)*\]$/.test(value)) {
                return error(`Invalid matrix. Use syntax: [1,2/a,4]`)
            }

            let str = value.slice(1, value.length - 1)
            let rows = str.split("/").map(rowStr => {
                let values = rowStr.split(",")
                for (let i = 0; i < values.length; i++) {
                    if (/^(-?[0-9]+(\.[0-9]+)?)$/.test(values[i])) {
                        values[i] = parseFloat(values[i])
                    }
                }
                return values
            })

            if (rows.some(row => row.length != rows[0].length)) {
                return error(`Matrix must have equal sized rows.`)
            }

            if (argOption.type == "square-matrix") {
                if (rows.length != rows[0].length) {
                    return error(`Matrix must be square.`)
                }
            }

            addVal(rows)
        } else {
            addVal(value)
        }
    }

    static parseArguments(tempTokens, command={
        defaultValues: {},
        args: {},
        name: "",
        helpFunc: null,
        info: {}
    }) {
        let args = command.args, defaultValues = command.defaultValues ?? {}

        let argsArray = (args.toString() == "[object Object]") ? Object.keys(args) : args
        let argOptions = argsArray.map(this.parseArgOptions).flat()

        const parsingError = {
            message: undefined,
            tokenIndex: undefined,
            tokenSpan: 0
        }

        Object.entries(defaultValues).forEach(([name, value]) => {
            this.getArgOption(argOptions, name).default = value
            this.getArgOption(argOptions, name).value = value
        })

        if (args.toString() == "[object Object]")
            Object.entries(args).map(([arg, description], i) => {
                argOptions[i].description = description
                if (argOptions[i].type == "enum") {
                    const enumOptionStr = argOptions[i].enumOptions.join(" | ")
                    argOptions[i].description = argOptions[i].description.replaceAll("<enum>", enumOptionStr)
                }
            })
        
        const ignoreIndeces = this.parseNamedArgs(tempTokens, argOptions, parsingError)
        
        if (parsingError.message) {
            return {argOptions, parsingError}
        }

        ignoreIndeces.push(0)

        let argOptionIndex = 0
        for (let i = 0; i < tempTokens.length; i++) {
            if (ignoreIndeces.includes(i))
                continue
            
            const token = tempTokens[i]
            const argOption = argOptions[argOptionIndex]

            if (!argOption) {
                parsingError.message = "Too many arguments"
                parsingError.tokenIndex = i
                parsingError.tokenSpan = 99999
                return {argOptions, parsingError}
            }

            argOptionIndex++
            if (argOption.expanding) {
                if (!argOption._hasExpanded) {
                    argOption.tokenIndex = i
                    argOption.tokenSpan = 0
                    argOption._hasExpanded = true
                } else {
                    argOption.tokenSpan++
                }

                argOptionIndex--
            } else {
                argOption.tokenIndex = i
            }

            this._parseArgumentValue(argOption, token, parsingError)

            if (parsingError.message) {
                return {argOptions, parsingError}
            }
        }

        // check for missing required arguments
        for (let arg of argOptions) {
            if (!arg.optional && !arg.isManuallySetValue) {
                parsingError.message = `argument "${arg.name}" (${arg.typeName}) is missing`
                parsingError.tokenIndex = 99999
                return {argOptions, parsingError}
            }
        }

        return {argOptions, parsingError}
    }

    static _printParserError(command, argOptions, errMessage, {isHelp=false}={}) {
        let tempArgOptions = argOptions.filter(arg => !arg.isHelp)

        terminal.print("$ ", terminal.data.accentColor2)
        terminal.print(command.name + " ")
        if (tempArgOptions.length == 0)
            terminal.print("doesn't accept any arguments")
        terminal.printLine(tempArgOptions.map(arg => {
            let name = arg.name
            if (arg.optional) name = "?" + name
            return `<${name}>`
        }).join(" "), terminal.data.accentColor1)
        
        let maxArgNameLength = Math.max(...tempArgOptions.map(arg => arg.fullName.length))

        for (let argOption of tempArgOptions) {
            let autoDescription = ""

            if (argOption.default) {
                autoDescription += ` [default: ${argOption.default}]`
            } else if (argOption.optional) {
                autoDescription += " [optional]"
            }

            if (argOption.type == "number") {
                autoDescription += " [numeric"
                if (argOption.min != null) {
                    autoDescription += `: ${argOption.min}`
                    autoDescription += ` to ${argOption.max}`
                }
                autoDescription += "]"
            }

            let combinedDescription = autoDescription + " " + argOption.description

            if (combinedDescription.trim().length == 0)
                continue

            terminal.print(" > ")

            let argName = argOption.fullName
            if (argName.length > 1) argName = "--" + argName
            else argName = "-" + argName
            
            terminal.print(argName.padEnd(maxArgNameLength + 3), terminal.data.accentColor1)

            if (combinedDescription.length > 50) {
                terminal.printLine(autoDescription)
                terminal.print(" ".repeat(maxArgNameLength + 7))
                terminal.printLine(argOption.description)
            } else if (combinedDescription.length > 0) {
                terminal.printLine(combinedDescription)
            }
        }

        if (isHelp && command.helpFunc) {
            command.helpFunc()
        }

        if (errMessage)
            terminal.printError(errMessage, "ParseError")
    }

}

class Command {

    constructor(name, callback, info) {
        this.name = name
        this.callback = callback
        this.info = info
        this.args = info.args ?? {}
        this.helpFunc = info.helpFunc ?? null
        this.description = info.description ?? ""
        this.defaultValues = info.defaultValues ?? info.standardVals ?? {}
        this.author = info.author ?? "viren bahure" // all rights reserved
        this.windowScope = null
    }

    get terminal() {
        return this.windowScope.terminal
    }

    set terminal(newTerminal) {
        this.windowScope.terminal = newTerminal
    }

    checkArgs(tokens) {
        if (this.info.rawArgMode)
            return true
        try {
            const {parsingError} = TerminalParser.parseArguments(tokens, this)
            return !parsingError.message
        } catch (error) {
            return false
        }
    }

    processArgs(tokens, rawArgs) {
        if (this.info.rawArgMode)
            return rawArgs

        let {argOptions, parsingError} = TerminalParser.parseArguments(tokens, this)
        if (parsingError.message) {
            TerminalParser._printParserError(this, argOptions, parsingError.message)
            throw new IntendedError()
        }

        let valueObject = {}
        for (let argOption of argOptions) {
            for (let form of argOption.forms) {
                valueObject[form] = argOption.value
            }
        }

        return valueObject
    }

    async run(tokens, rawArgs, {callFinishFunc=true, terminalObj=undefined, processArgs=true}={}) {
        if (terminalObj)
            this.terminal = terminalObj
        if (callFinishFunc)
            this.terminal.expectingFinishCommand = true

        try {
            const passingArguments = processArgs
                ? [this.processArgs(tokens, rawArgs)]
                : [rawArgs, tokens]

            if (this.callback.constructor.name === 'AsyncFunction') {
                await this.callback(...passingArguments)
            } else {
                this.callback(...passingArguments)
            }

            if (callFinishFunc)
                this.terminal.finishCommand()
            return true
        } catch (error) {
            if (!(error instanceof IntendedError)) {
                this.terminal.printError(error.message, error.name)
                console.error(error)
            }

            if (callFinishFunc) {
                this.terminal.finishCommand()
            }

            // if the sleep command was called a max number
            // of times, it's considered to be a success
            return this.terminal.tempActivityCallCount === this.terminal.tempMaxActivityCallCount
        }
    }

}

const UtilityFunctions = {

    downloadFile(file) {
        if (file.isDirectory) {
            throw new Error("Cannot download directories")
        }

        let element = document.createElement('a')
        if (file.type == FileType.DATA_URL)
            var dataURL = file.content
        else
            var dataURL = 'data:text/plain;charset=utf-8,' + encodeURIComponent(file.content)
        element.setAttribute('href', dataURL)
        element.setAttribute('download', file.name)
        element.style.display = 'none'
        document.body.appendChild(element)
        element.click()
        document.body.removeChild(element)
    },

    mulberry32(a) {
        return function() {
          var t = a += 0x6D2B79F5;
          t = Math.imul(t ^ t >>> 15, t | 1);
          t ^= t + Math.imul(t ^ t >>> 7, t | 61);
          return ((t ^ t >>> 14) >>> 0) / 4294967296;
        }
    },

    levenshteinDistance(str1, str2) {
        const track = Array(str2.length + 1).fill(null).map(
            () => Array(str1.length + 1).fill(null))

        for (let i = 0; i <= str1.length; i += 1) track[0][i] = i
        for (let j = 0; j <= str2.length; j += 1) track[j][0] = j

        for (let j = 1; j <= str2.length; j += 1) {
            for (let i = 1; i <= str1.length; i += 1) {
                const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1
                track[j][i] = Math.min(
                    track[j][i - 1] + 1,
                    track[j - 1][i] + 1,
                    track[j - 1][i - 1] + indicator,
                )
            }
        }

        return track[str2.length][str1.length]
    },

    stringPad(string, length, char=" ") {
        return string.toString().padStart(length, char)
    },

    stringPadBack(string, length, char=" ") {
        return string.toString().padEnd(length, char)
    },

    stringPadMiddle(string, length, char=" ") {
        string = string.toString()
        while (string.length < length) {
            string = char + string + char
        }
        while (string.length > length) {
            string = string.slice(1)
        }
        return string
    },

    stringMul(string, count) {
        return string.toString().repeat(count)
    },

    strRepeat(string, count) {
        return string.toString().repeat(count)
    },

    Color,

    FileType,
    FilePath,
    TerminalFile,
    DataURLFile,
    DirectoryFile,
    PlainTextFile,

    async playFrequency(f, ms, volume=0.5, destination=null, returnSleep=true) {
        if (!terminal.audioContext) {
            terminal.audioContext = new(window.AudioContext || window.webkitAudioContext)()
            if (!terminal.audioContext)
                throw new Error("Browser doesn't support Audio")
        }
    
        let oscillator = terminal.audioContext.createOscillator()
        oscillator.type = "square"
        oscillator.frequency.value = f
    
        let gain = terminal.audioContext.createGain()
        gain.connect(destination || terminal.audioContext.destination)
        gain.gain.value = volume
    
        oscillator.connect(gain)
        oscillator.start(terminal.audioContext.currentTime)
        oscillator.stop(terminal.audioContext.currentTime + ms / 1000)
    
        if (returnSleep)
            return terminal.sleep(ms)
    },

    parseColor(input) {
        // very slow but works
        // (creates a canvas element and draws the color to it
        //  then reads the color back as RGB)

        let canvas = document.createElement("canvas")
        canvas.width = 1
        canvas.height = 1
        let ctx = canvas.getContext("2d")
        ctx.fillStyle = input
        ctx.fillRect(0, 0, 1, 1)
        let data = ctx.getImageData(0, 0, 1, 1).data
        return new Color(data[0], data[1], data[2])
    },

    TerminalParser: TerminalParser,
    Command: Command,
    IntendedError: IntendedError,

    addAlias(alias, command) {
        if (terminal.inTestMode) return
        terminal.data.addAlias(alias, command)
        terminal.log(`Added alias "${alias}" for command "${command}"`)
    },

    shuffle(array) {
        // shuffles the array in-place and returns it using
        // the fischer-yates shuffle algorithm
        let cI = array.length
        while (cI != 0) {
            const rI = Math.floor(Math.random() * cI)
            cI--
            [array[cI], array[rI]] = [array[rI], array[cI]]
        }
        return array
    }

}

class TerminalModules {

    modulePath = "js/modules"

    constructor() {}

    async load(name, terminalObj) {
        if (terminalObj.inTestMode) {
            terminalObj.tempActivityCallCount = terminalObj.tempMaxActivityCallCount
            throw new IntendedError()
        }

        if (this[name])
            return this[name]

        let url = `${this.modulePath}/${name}.js`
        await terminalObj._loadScript(url)
        return this[name]
    }

    async import(name, window) {
        await this.load(name, window.terminal)
        for (let [key, value] of Object.entries(this[name])) {
            window[key] = value
        }
    }

}

let ALL_TERMINALS = {}
let CORRECTNESS_CACHE = {}

const OutputChannel = {
    USER: "user",
    NONE: "none",
    CACHE_AND_USER: "cache_and_user",
}

class KeyboardShortcut {

    constructor(key, callback, {
        ctrl=undefined,
        alt=undefined,
        shift=undefined
    }={}) {
        this.key = key
        this.callback = callback
        this.ctrl = ctrl
        this.alt = alt
        this.shift = shift
    }

    run(event) {
        this.callback(event)
    }

}

class Terminal {

    parser = TerminalParser

    parentNode = document.getElementById("terminal")
    containerNode = document.querySelector(".terminal-container")
    commandListURL = "js/load-commands.js"
    mobileKeyboardURL = "js/keyboard.js"
    defaultFileystemURL = "js/defaultFilesystem.js"
    sidePanelURL = "js/html/side-panel.js"

    mobileKeyboard = null
    currInputElement = null
    currSuggestionElement = null
    currInputContainer = null
    correctIndicator = null
    expectingFinishCommand = false
    commandCache = {}
    testProcessID = 0
    tempActivityCallCount = 0
    tempMaxActivityCallCount = Infinity
    debugMode = false
    tempCommandInputHistory = []

    guiMode = false

    keyboardShortcuts = []

    name = ""
    data = new TerminalData()
    fileSystem = new FileSystem()
    modules = new TerminalModules()

    outputChannel = OutputChannel.USER
    outputCacheVarName = null

    variableCache = {}

    loadingKey = null
    baseUrl = ""

    getOutputCache(key) {
        if (this.variableCache[key] === undefined)
            return ""
        return this.variableCache[key]
    }

    writeToOutputCache(value) {
        if (this.outputChannel == OutputChannel.NONE)
            throw new Error("Cannot write to output cache when output channel is set to none")
        if (this.outputCacheVarName === null)
            throw new Error("Cannot write to output cache when output cache var name is not set")

        let currCache = this.getOutputCache(this.outputCacheVarName)
        this.variableCache[this.outputCacheVarName] = currCache + value
    }

    getVariableValue(name) {
        return this.variableCache[name]
    }

    async setLoading(file) {
        let randomKey = Math.random().toString()
        this.loadingKey = randomKey

        // wait a bit before showing the loading overlay
        await this.sleep(150)

        if (this.loadingKey != randomKey)
            return

        this.unsetLoading()
        this.loadingElement = terminal.printLine(`\nLoading ${file}`, undefined, {forceElement: true})
    }

    async unsetLoading() {
        this.loadingKey = null
        if (this.loadingElement) {
            this.loadingElement.remove()
            this.loadingElement = null
        }
    }

    scroll(behavior="smooth", toLeft=true) {
        let opts = {
            top: 10 ** 9, // sufficiently large number
            // (number must be lower than 10**10, as firefox doesn't allow those values)
            behavior
        }
        if (toLeft)
            opts.left = 0
        this.parentNode.scrollTo(opts)
        this.containerNode.scrollTo(opts)
    }

    isUrlParamSet(param) {
        return new URLSearchParams(window.location.search).has(param)
    }

    get inTestMode() {
        return this.outputChannel == OutputChannel.NONE
    }

    addKeyboardShortcut(shortcut) {
        this.keyboardShortcuts.push(shortcut)
    }

    removeCurrInput() {
        if (this.currInputContainer) {
            this.currInputContainer.remove()
        }

        if (this.currCorrectnessOutput) {
            this.currCorrectnessOutput.remove()
        }

        this.currInputContainer = null
        this.currCorrectnessOutput = null
        this.currInputElement = null
        this.currSuggestionElement = null
    }

    _interruptSTRGC() {
        if (this.inTestMode)
            return
        
        terminal.printError("Pressed [^c]", "\nInterrupt")
        terminal.expectingFinishCommand = true
        for (let callback of this._interruptCallbackQueue)
            callback()
        this._interruptCallbackQueue = []
        terminal.finishCommand()
    }

    getFile(path, fileType=undefined) {
        // throws error if file not found
        let file = this.fileSystem.getFile(path)
        if (file == null) {
            throw new Error(`File "${path}" not found`)
        }
        if (fileType && file.type != fileType)
            throw new Error(`File "${path}" is not a ${fileType}`)
        return file
    }

    async createFile(fileName, fileType, data) {
        if (!terminal.isValidFileName(fileName))
            throw new Error("Invalid filename")
        if (terminal.fileExists(fileName))
            throw new Error("File already exists")
        let newFile = new (fileType)(data)
        if (!terminal.inTestMode) {
            terminal.currDirectory.content[fileName] = newFile
            await terminal.fileSystem.reload()
        }
        return newFile
    }

    fileExists(path) {
        return !!this.fileSystem.getFile(path)
    }

    updatePath() {
        this.data.path = this.fileSystem.path.items
    }

    isValidFileName(name) {
        return name.match(/^[a-zA-Z0-9_\-\.]{1,100}$/)
    }

    async copy(text, {printMessage=false}={}) {
        if (terminal.inTestMode)
            return
        
        await navigator.clipboard.writeText(text)

        if (printMessage)
            terminal.printLine("Copied to Clipboard ✓")
    }

    async sleep(ms) {
        terminal.tempActivityCallCount++
        if (terminal.tempActivityCallCount === terminal.tempMaxActivityCallCount)
            throw new IntendedError()

        if (terminal.outputChannel == OutputChannel.NONE)
            return

        let running = true
        let aborted = false
        const intervalFunc = () => {
            if (!running) return
            if (terminal.pressed.Control && terminal.pressed.c || terminal._interruptSignal) {
                terminal._interruptSignal = false
                running = false
                clearInterval(interval)
                aborted = true
                terminal._interruptSTRGC()
            }
        }

        let interval = setInterval(intervalFunc, 50)
        intervalFunc()

        return new Promise(resolve => {
            setTimeout(() => {
                running = false
                clearInterval(interval)
                if (!aborted) resolve()
            }, ms)
        })
    }

    interrupt() {
        this._interruptSignal = true
    }

    onInterrupt(callback) {
        this._interruptCallbackQueue.push(callback)
    }

    reload() {
        location.reload()
    }

    href(url) {
        if (terminal.inTestMode)
            return
        window.location.href = url
    }

    setInputCorrectness(correct) {
        if (!this.correctIndicator)
            return
        if (correct) {
            this.correctIndicator.style.color = Color.LIGHT_GREEN.toString()
        } else {
            this.correctIndicator.style.color = Color.ERROR.toString()
        }
    }

    getAutoCompleteOptions(text) {
        let lastWord = text.split(/\s/g).pop()
        const allRelativeFiles = this.fileSystem.allFiles()
            .map(file => file.path.toString())
            .concat(this.fileSystem.currDirectory.allChildren.map(c => c.path.toString().slice(this.fileSystem.pathStr.length)))

        const configMatches = ms => ms.filter(f => f.startsWith(lastWord))
            .sort().sort((a, b) => a.length - b.length)

        const exportMatches = ms => ms.map(match => {
            let words = text.split(" ")
            words.pop()
            words.push(match)
            return words.join(" ")
        }).filter(s => s != text)

        const addApostrophes = ms => ms.map(m => {
            if (m.includes(" ")) {
                let apostrphe = '"'
                if (m.includes(apostrphe)) {
                    apostrphe = "'"
                    if (m.includes(apostrphe)) {
                        apostrphe = ""
                        // TODO: add more apostrophe types to prevent this
                    }
                } 
                return `${apostrphe}${m}${apostrphe}`
            }
            return m
        })

        let commandMatches = configMatches(this.visibleFunctions.map(f => f.name)
            .concat(Object.keys(this.data.aliases)))

        // if is first word
        if (lastWord === text.trim()) {
            return exportMatches(commandMatches)
        }

        let fileMatches = configMatches(addApostrophes(allRelativeFiles))

        const {argOptions} = this.parse(text)

        let currArgOption = {}
        if (text.slice(-1) == " ") {
            const nextArgOption = argOptions.filter(o => !o.isManuallySetValue)[0]
            if (nextArgOption !== undefined) {
                currArgOption = nextArgOption
            }
        } else {
            currArgOption = argOptions.reduce((p, c) => c.tokenIndex ? (c.tokenIndex > p.tokenIndex ? c : p) : p, {tokenIndex: 0})
        }

        // if an argOption is currently being edited
        if (currArgOption.name) {
            if (currArgOption.type == "boolean") {
                return exportMatches(configMatches(argOptions.filter(o => !o.isManuallySetValue)
                    .map(o => o.name.length > 1 ? `--${o.name}` : `-${o.name}`)))
            }

            if (currArgOption.type == "file") {
                return exportMatches(fileMatches)
            }

            if (currArgOption.type == "command") {
                return exportMatches(commandMatches)
            }

            if (currArgOption.type == "enum") {
                return exportMatches(configMatches(currArgOption.enumOptions))
            }
        }

        return []
    }

    sanetizeInput(text) {
        text = text.replaceAll(/![0-9]+/g, match => {
            let index = parseInt(match.slice(1)) - 1
            if (terminal.data.history[index])
                return terminal.data.history[index]
            return match
        })
        text = text.replaceAll(/!!/g, () => {
            return terminal.data.history[terminal.data.history.length - 1] ?? ""
        })
        for (let [alias, command] of Object.entries(terminal.data.aliases)) {
            text = text.replaceAll(RegExp(`^${alias}`, "g"), command)
        }
        return text
    }

    turnToTestMode() {
        this.outputChannel = OutputChannel.NONE
    }

    async updateInputCorrectnessDebug(text) {
        // experimental feature
        // this is a very hacky way to do this
        // and produces a lot of side effects and bugs
        // (for now hidden in debug mode)

        this.testProcessID++

        let virtualTerminal = new Terminal(`v${this.testProcessID}`)
        await virtualTerminal.initFrom(this)
        virtualTerminal.turnToTestMode()
        virtualTerminal.testProcessID = this.testProcessID

        virtualTerminal.tempActivityCallCount = 0
        virtualTerminal.tempMaxActivityCallCount = 1
        
        let wentWell = true

        try {
            wentWell = await virtualTerminal.input(text, true)
        } catch {
            wentWell = false
        }

        if (!wentWell) {
            wentWell = virtualTerminal.tempActivityCallCount === virtualTerminal.tempMaxActivityCallCount
        }

        if (virtualTerminal.testProcessID == this.testProcessID) {
            this.setInputCorrectness(wentWell)
        }

        CORRECTNESS_CACHE[text] = wentWell
    }

    async updateInputCorrectness(text) {
        if (text.trim().length == 0) {
            this.setInputCorrectness(true)
            return
        }

        if (this.debugMode)
            return await this.updateInputCorrectnessDebug(text)

        if (text in CORRECTNESS_CACHE) {
            this.setInputCorrectness(CORRECTNESS_CACHE[text])
            return
        }

        if (TerminalParser.isVariable(text)) {
            let name = TerminalParser.extractVariableName(text + "=")
            this.setInputCorrectness(name in this.variableCache)
            return
        }

        let assignmentInfo = TerminalParser.extractAssignment(text)
        if (assignmentInfo) {
            text = assignmentInfo.value
        }

        let tokens = TerminalParser.tokenize(text)
        tokens = TerminalParser.replaceVariables(tokens, this.variableCache)
        let [commandText, args] = TerminalParser.extractCommandAndArgs(tokens)
        if (!this.commandExists(commandText)) { 
            this.setInputCorrectness(false)
            return
        }

        let commandData = this.commandData[commandText] 
        this.setInputCorrectness(true)

        let tempCommand = new Command(commandText, () => undefined, commandData)
        tempCommand.windowScope = this.window
        tempCommand.terminal = this
        this.setInputCorrectness(tempCommand.checkArgs(tokens))
    }

    _createDefaultGetHistoryFunc() {
        if (this.commandIsExecuting) {
            return () => this.tempCommandInputHistory
        } else {
            return () => this.data.history
        }
    }

    _createDefaultAddToHistoryFunc() {
        if (this.commandIsExecuting) {
            return data => this.tempCommandInputHistory.push(data)
        } else {
            return data => this.data.addToHistory(data)
        }
    }

    focusInput({element=null, options={}}={}) {
        if (this.mobileKeyboard) {
            this.mobileKeyboard.show()
            return
        }

        let input = element ?? this.currInputElement
        if (input) {
            input.focus(options)
        }
    }

    updateCorrectnessText(prompt, element, inputElement) {
        const {text, color} = this.getCorrectnessText(prompt, inputElement)
        element.textContent = text ? "\n" + text : ""
        if (color) {
            element.style.color = color
        }
    }

    parse(prompt) {
        const tokens = TerminalParser.tokenize(prompt)
        let [commandText, args] = TerminalParser.extractCommandAndArgs(tokens)

        if (commandText == undefined) {
            return {argOptions: [], parsingError: {
                message: undefined, tokenIndex: undefined, tokenSpan: 0
            }}
        }

        if (!this.commandExists(commandText)) { 
            return {argOptions: [], parsingError: {
                message: "command not found", tokenIndex: 0, tokenSpan: 0
            }}
        }

        let commandData = this.commandData[commandText]

        let tempCommand = new Command(commandText, () => undefined, commandData)
        tempCommand.windowScope = this.window
        tempCommand.terminal = this

        return TerminalParser.parseArguments(tokens, tempCommand)
    }

    getCorrectnessText(prompt, inputElement) {
        if (prompt.length == 0)
            return ""

        let tokens = TerminalParser.tokenize(prompt)

        const underlinePart = (startIndex, length, message, color=Color.ERROR) => {
            if (message == "") return {text: ""}

            const inputOffset = this.fileSystem.pathStr.length
            let out = " ".repeat(inputOffset + startIndex) + "┬" + "─".repeat(Math.max(length - 1, 0)) + "\n"
            out += " ".repeat(inputOffset + startIndex) + "|\n"
            
            let lines = message.split("\n").filter(l => !!l)
            for (let i = 0; i < lines.length; i++) {
                let line = lines[i]
                let beforeChar = i == lines.length - 1 ? "└" : "├"
                out += " ".repeat(inputOffset + startIndex) + beforeChar + " " + line + "\n"
            }

            return {text: out, color}
        }

        const positionFromToken = tokenIndex => {
            let startPosition = 0
            let tempPrompt = prompt
            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i]
                let firstIndex = tempPrompt.indexOf(token)
                tempPrompt = tempPrompt.slice(firstIndex + token.length)
                startPosition = prompt.length - (tempPrompt.length + token.length) + 1

                if (i == tokenIndex) {
                    break
                }
            }
            return startPosition
        }

        const underLineToken = (tokenIndex, tokenSpan, message, color=Color.ERROR) => {
            if (tokenIndex >= tokens.length) {
                let offset = prompt.length + 1
                if (prompt.slice(-1) == " ") offset--
                return underlinePart(offset, 3, message, color)
            }

            tokenSpan = Math.min(tokenSpan, tokens.length - 1 - tokenIndex)

            let startPosition = positionFromToken(tokenIndex)
            let endPosition = startPosition + tokens[tokenIndex].length
            for (let i = 0; i < tokenSpan; i++) {
                endPosition = positionFromToken(tokenIndex + i + 1)
                endPosition += tokens[tokenIndex + i + 1].length
            }

            return underlinePart(startPosition - 1, endPosition - startPosition, message, color)
        }

        let [commandText, args] = TerminalParser.extractCommandAndArgs(tokens)

        if (commandText == undefined) {
            return ""
        }

        if (!this.commandExists(commandText)) { 
            return underlinePart(prompt.indexOf(commandText), commandText.length, `command not found`)
        }

        let commandData = this.commandData[commandText]

        let tempCommand = new Command(commandText, () => undefined, commandData)
        tempCommand.windowScope = this.window
        tempCommand.terminal = this

        let {argOptions, parsingError} = TerminalParser.parseArguments(tokens, tempCommand)

        if (parsingError.message && tokens.length > 1 && !commandData.rawArgMode) {
            return underLineToken(parsingError.tokenIndex, parsingError.tokenSpan, parsingError.message)
        }

        const makeArgumentInfo = argOption => {
            let out = ""
            if (argOption.name.length == 1) {
                out += `-`
            } else {
                out += `--`
            }
            out += `${argOption.name}`

            out += " ("
            if (argOption.optional) {
                out += "optional, "
            }
            out += `${argOption.typeName}) `
            
            if (argOption.type == "enum") {
                const optionStr = argOption.enumOptions.join(" | ")
                return `${out}: ${optionStr.length > 30 ? (optionStr.slice(0, 40) + "...") : optionStr}`
            }

            out += argOption.description

            return out
        }

        const makeCommandInfoString = () => {
            let out = ""

            let filteredOptions = argOptions.filter(o => !o.isManuallySetValue)
            for (let argOption of filteredOptions) {
                out += `${makeArgumentInfo(argOption)}\n`
            }
            
            return out
        }

        let currTokenIndex = 0
        for (let i = 0; i < tokens.length; i++) {
            let position = positionFromToken(i)
            if (inputElement.selectionStart >= position - 1) {
                currTokenIndex = i
            }
        }

        let currArgOption = undefined
        for (let argOption of argOptions) {
            if (argOption.tokenIndex == undefined) {
                continue
            }

            if (currTokenIndex >= argOption.tokenIndex && currTokenIndex <= argOption.tokenIndex + argOption.tokenSpan) {
                currArgOption = argOption
                break
            }
        }

        if ((tokens.length == 1 && prompt.slice(-1) != " ") || argOptions.length == 0 || (currTokenIndex == 0 && tokens.length > 1)) {
            return underLineToken(0, 0, `"${commandData.description}"`, Color.fromHex("#9d64ff"))
        }

        // user is at end of selection and wants more info about arguments
        if (prompt.slice(-1) == " " && prompt.length == inputElement.selectionStart) {
            return underLineToken(9999, 1, makeCommandInfoString(), Color.fromHex("#9d64ff"))
        }

        if (currArgOption) {
            return underLineToken(currArgOption.tokenIndex, currArgOption.tokenSpan,
                makeArgumentInfo(currArgOption), Color.fromHex("#9d64ff"))
        }

        return ""
    }

    createStyledInput() {
        let input = document.createElement("input")
        input.type = "text"
        input.className = "terminal-input"
        input.autocomplete = "off"
        input.autocorrect = "off"
        input.autocapitalize = "off"
        input.spellcheck = "false"
        input.name = "terminal-input"
        return input
    }

    createTerminalButton({
        text="Press here!",
        charWidth=8,
        onPress=undefined
    }={}) {
        let button = this.document.createElement("button")

        button.textContent = text
        button.onclick = onPress
        
        button.style.width = `${this.charWidth * charWidth}px`
        button.style.backgroundColor = terminal.data.foreground.toString()
        button.style.color = terminal.data.background.toString()
        button.style.cursor = "pointer"

        return button
    }

    async prompt(msg, {password=false, affectCorrectness=false,
        getHistory = this._createDefaultGetHistoryFunc(),
        addToHistory = this._createDefaultAddToHistoryFunc(),
        inputCleaning=!this.commandIsExecuting,
        inputSuggestions=!this.commandIsExecuting,
        mobileLayout=undefined,
        printInputAfter=true,
        makeClickCopy=true
    }={}) {
        if (this.inTestMode) {
            this.tempActivityCallCount++
            return ""
        }

        function lastItemOfHistory() {
            let history = getHistory()
            return history[history.length - 1]
        }

        if (msg) terminal.print(msg)

        const createInput = () => {
            let inputContainer = document.createElement("div")
            inputContainer.className = "terminal-input-container"

            let input = this.createStyledInput()

            if (this.mobileKeyboard) {
                input.addEventListener("focus", () => {
                    this.mobileKeyboard.show()
                })
                input.readOnly = true
                input.inputMode = "none"
            }

            // for screen readers (bots) only
            let label = document.createElement("label")
            label.className = "terminal-input-label"
            label.textContent = "Input a terminal command"
            label.style.display = "none"
            label.htmlFor = "terminal-input"
            inputContainer.appendChild(label)

            let suggestion = document.createElement("div")
            suggestion.className = "terminal-suggestion"
            
            inputContainer.appendChild(input)
            inputContainer.appendChild(suggestion)

            if (password) input.type = "password"
            return [input, suggestion, inputContainer]
        }

        let [inputElement, suggestionElement, inputContainer] = createInput()
        this.parentNode.appendChild(inputContainer)
        const inputMinWidth = () => {
            let rect = inputElement.getBoundingClientRect()
            return this.window.innerWidth - rect.left * 2
        }
        inputContainer.style.width = `${inputMinWidth()}px`

        this.currCorrectnessOutput = null
        let thisIsActivePrompt = true

        if (affectCorrectness) {
            this.currCorrectnessOutput = this.print("", Color.ERROR, {forceElement: true})
        }

        this.scroll("smooth", false)
        this.currInputElement = inputElement
        this.currSuggestionElement = suggestionElement
        this.currInputContainer = inputContainer
        this.focusInput({options: {preventScroll: true}})

        function getInputValueSanetized() {
            // IOS produces special characters instead of ascii ("-", "'", etc)
            // ~ Since we don't want em, we replace em ~
            return inputElement.value
                .replaceAll(/[\u2018\u2019\u201B\u2032\u2035]/g, "'")
                .replaceAll(/[\u201C\u201D\u201F\u2033\u2036]/g, '"')
                .replaceAll(/[\u2013\u2014]/g, "-")
        }

        return new Promise(resolve => {
            let inputValue = ""
            let keyListeners = {}

            keyListeners["Enter"] = event => {
                let text = getInputValueSanetized()

                const printText = password ? "•".repeat(text.length) : text
                if (printInputAfter) {
                    if (makeClickCopy) {
                        const outElement = this.printLine(printText, undefined, {forceElement: true})
                        outElement.addEventListener("click", event => {
                            if (this.currInputElement) {
                                this.currInputElement.value += printText
                                event.preventDefault()
                            }
                        })
                        outElement.style.cursor = "pointer"
                    } else {
                        this.printLine(printText)
                    }
                }

                if (inputCleaning) {
                    text = this.sanetizeInput(getInputValueSanetized())
                }

                if (text !== lastItemOfHistory() && text.length > 0) {
                    addToHistory(text)
                }

                this.removeCurrInput()

                if (this.currCorrectnessOutput) {
                    this.currCorrectnessOutput.remove()
                }

                resolve(text)
                thisIsActivePrompt = true
            }

            let tabIndex = 0
            let suggestions = []

            const completeSuggestion = () => {
                if (!inputSuggestions) {
                    inputElement.value += "    "
                    inputElement.oninput()
                    return
                }
                if (suggestions.length > 0) {
                    inputElement.value = suggestions[tabIndex % suggestions.length]
                    suggestionElement.textContent = ""
                    
                    tabIndex = (tabIndex + 1) % suggestions.length
                    inputValue = ""
                }
            }

            keyListeners["Tab"] = event => {
                event.preventDefault()
                completeSuggestion()
            }

            suggestionElement.onclick = () => {
                completeSuggestion()
                inputElement.oninput()
            }

            let historyIndex = getHistory().length
            keyListeners["ArrowUp"] = event => {
                event.preventDefault()
                let history = getHistory()
                if (historyIndex > 0) {
                    historyIndex--
                    inputElement.value = history[historyIndex]
                }
                inputElement.oninput()
            }

            keyListeners["ArrowDown"] = event => {
                event.preventDefault()
                let history = getHistory()
                historyIndex++
                if (historyIndex > history.length - 1) {
                    historyIndex = history.length
                    inputElement.value = ""
                } else {
                    inputElement.value = history[historyIndex]
                }
                inputElement.oninput()
            }

            inputElement.oninput = async event => {
                if (!thisIsActivePrompt) {
                    return
                }

                suggestions = this.getAutoCompleteOptions(getInputValueSanetized())

                if (!inputSuggestions) {
                    suggestionElement.textContent = ""
                    return
                }

                const replaceAlreadywritten = (oldText, replacement=" ") => {
                    let newText = ""
                    for (let i = 0; i < oldText.length; i++) {
                        if (inputElement.value[i]) {
                            newText += replacement
                        } else {
                            newText += oldText[i]
                        }
                    }
                    return newText
                }

                if (suggestions.length > 0 && inputElement.value.trim().length > 0) {
                    suggestionElement.textContent = replaceAlreadywritten(suggestions[0])
                } else {
                    suggestionElement.textContent = ""
                }

                if (affectCorrectness) {
                    let cleanedInput = this.sanetizeInput(getInputValueSanetized())
                    this.updateInputCorrectness(cleanedInput)
                    if (this.currCorrectnessOutput) {
                        this.updateCorrectnessText(getInputValueSanetized(), this.currCorrectnessOutput, inputElement)
                    }
                }

                let textLength = Math.max(inputElement.value.length, suggestionElement.textContent.length)
                // (textLength + 1) to leave room for the next character
                let inputWidth = (textLength + 1) * this.charWidth
                inputContainer.style.width = `max(${inputMinWidth()}px, ${inputWidth}px)`
            }

            inputElement.onselectionchange = () => {
                if (!thisIsActivePrompt) {
                    return
                }

                if (affectCorrectness) {
                    let cleanedInput = this.sanetizeInput(getInputValueSanetized())
                    this.updateInputCorrectness(cleanedInput)
                    if (this.currCorrectnessOutput) {
                        this.updateCorrectnessText(getInputValueSanetized(), this.currCorrectnessOutput, inputElement)
                    }
                }
            }

            inputElement.onkeydown = async (event, addToVal=true) => {
                if (!thisIsActivePrompt) {
                    return
                }

                if (addToVal) {
                    if (event.key.length == 1) // a, b, c, " "
                        inputValue = getInputValueSanetized() + event.key
                    else if (event.key == "Backspace")
                        inputValue = getInputValueSanetized().slice(0, -1)
                    else // Tab, Enter, etc.
                        inputValue = getInputValueSanetized()
                }

                if (keyListeners[event.key]) {
                    if (thisIsActivePrompt) {
                        keyListeners[event.key](event)
                    }
                } else {
                    tabIndex = 0
                }

                if (event.key == "c" && event.ctrlKey) {
                    if (this.currCorrectnessOutput) {
                        this.currCorrectnessOutput.remove()
                    }

                    this.removeCurrInput()
                    this._interruptSTRGC()
                    thisIsActivePrompt = false
                }

                // call async to let selection be updated before event is fired
                setTimeout(inputElement.onselectionchange, 0)
            }

            addEventListener("resize", event => {
                let inputWidth = (inputElement.value.length + 1) * this.charWidth
                inputContainer.style.width = `max(${inputMinWidth()}px, ${inputWidth}px)`
            })

            if (this.mobileKeyboard) {
                if (mobileLayout === undefined)
                    this.mobileKeyboard.updateLayout(this.mobileKeyboard.Layout.DEFAULT)
                else
                    this.mobileKeyboard.updateLayout(mobileLayout)

                this.mobileKeyboard.show()
                this.mobileKeyboard.oninput = event => {
                    if (event.key == "Backspace")
                        inputElement.value = getInputValueSanetized().slice(0, -1)

                    if (!event.isFunctionKey) {
                        inputElement.value += event.keyValue
                    }

                    inputValue = inputElement.value

                    inputElement.onkeydown(event, false)
                    inputElement.oninput(event)

                    this.scroll("smooth", false)
                }
            }

        })

    }

    async acceptPrompt(msg, standardYes=true) {
        const nope = () => {throw new IntendedError("Nope")}
        let extraText = ` [${standardYes ? "Y/n" : "y/N"}] `
        let text = await this.prompt(msg + extraText, {mobileLayout: [["y", "n"], ["<", "Enter"]]})

        if (text == "" && standardYes) return true
        if (text.toLowerCase().startsWith("y")) return true

        nope()
    }

    async promptNum(msg=null, {min=null, max=null, integer=false}={}) {
        min = min ?? -Infinity
        max = max ?? Infinity
        while (true) {
            let inp = await this.prompt(msg)
            if (isNaN(inp) || inp.length == 0) {
                this.printError("You must supply a valid number")
                continue
            }
            let num = parseFloat(inp)
            if (min > num) {
                this.printError(`The number must be larger/equal than ${min}`)
            } else if (max < num) {
                this.printError(`The number must be smaller/equal than ${max}`)
            } else if (integer && !Number.isInteger(num)) {
                this.printError(`The number must be an integer`)
            } else {
                return num
            }
        }
    }

    print(text, color=undefined, {
        forceElement=false, element="span", fontStyle=undefined,
        background=undefined, addToCache=true, outputNode=undefined
    }={}) {
        outputNode ??= this.parentNode

        if (this.outputChannel == OutputChannel.CACHE_AND_USER && addToCache) {
            this.writeToOutputCache(text)
        }

        text ??= ""
        let output = undefined
        if (color === undefined && !forceElement && fontStyle === undefined && background === undefined) {
            let textNode = document.createTextNode(text)
            if (!this.inTestMode)
                outputNode.appendChild(textNode)
            output = textNode
        } else {
            let span = document.createElement(element)
            span.textContent = text
            if (color !== undefined) span.style.color = color.string.hex
            if (fontStyle !== undefined) span.style.fontStyle = fontStyle
            if (background !== undefined) {
                span.style.backgroundColor = background.string.hex
            }

            if (!this.inTestMode) {
                outputNode.appendChild(span)
            }
            output = span
        }
        return output
    }

    printItalic(text, color=undefined, opts) {
        return this.printLine(text, color, {...opts, fontStyle: "italic"})
    }

    printImg(src, {
        altText = "",
        outputNode = undefined
    }={}) {
        outputNode ??= this.parentNode

        if (this.inTestMode)
            return

        let img = outputNode.appendChild(document.createElement("img"))
        img.src = src
        img.alt = altText
        img.classList.add("terminal-img")
        img.onload = this._styleImgElement.bind(this, img)
        return img
    }

    _styleImgElement(img, invertSetting=false, {maxWidth=40, maxHeight=40}={}) {
        img.style.aspectRatio = img.naturalWidth / img.naturalHeight
        let changeCondition = img.clientHeight < img.clientWidth
        if (invertSetting) changeCondition = !changeCondition
        if (changeCondition) {
            img.style.width = "auto"
            let height = Math.min(img.naturalHeight, maxHeight)
            img.style.height = `calc(var(--font-size) * ${height})`
        } else {
            img.style.height = "auto"
            let width = Math.min(img.naturalWidth, maxWidth)
            img.style.width = `calc(var(--font-size) * ${width})`
        }
    }

    printTable(inRows, headerRow=null, opts) {
        let rows = inRows.map(r => r.map(c => (c == undefined) ? " " : c))
        if (headerRow != null) rows.unshift(headerRow)
        const column = i => rows.map(row => row[i])
        const columnWidth = i => Math.max(...column(i)
            .map(e => String((e == undefined) ? " " : e).length))
        for (let rowIndex = 0; rowIndex <= rows.length; rowIndex++) {
            if (rowIndex == 0
                || (rowIndex == 1 && headerRow != null)
                || (rowIndex == rows.length)) {
                let line = ""
                for (let columnIndex = 0; columnIndex < rows[0].length; columnIndex++) {
                    let item = UtilityFunctions.stringMul("-", columnWidth(columnIndex))
                    line += `+-${item}-`
                }
                line += "+"
                this.printLine(line, opts)
            }
            if (rowIndex == rows.length) break
            let line = ""
            for (let columnIndex = 0; columnIndex < rows[0].length; columnIndex++) {
                let itemVal = rows[rowIndex][columnIndex]
                if (itemVal == undefined) itemVal = " "
                let padFunc = (rowIndex == 0 && headerRow != null) ? UtilityFunctions.stringPadMiddle : UtilityFunctions.stringPadBack
                let item = padFunc(itemVal, columnWidth(columnIndex))
                line += `| ${item} `
            }
            line += "|  "
            this.printLine(line, opts)
        }
    }

    async animatePrint(text, interval=50, {newLine=true}={}) {
        if (interval == 0) {
            this.print(text)
        } else {
            for (let char of text) {
                this.print(char)
                await this.sleep(interval)
            }
        }
        if (newLine) this.printLine()
    }

    printLine(text, color, opts) {
        text ??= ""
        return this.print(text + "\n", color, opts)
    }

    printError(text, name="Error", opts) {
        this.print(name, new Color(255, 0, 0), opts)
        this.printLine(": " + text, undefined, opts)
        this.log(text, {type: "error"})
    }

    printSuccess(text) {
        this.printLine(text, new Color(0, 255, 0))
    }

    addLineBreak(n=1) {
        for (let i = 0; i < n; i++)
            this.printLine()
    }

    printClickable(text, callback, color, opts) {
        let element = this.print(text, color, {forceElement: true, ...opts})
        element.onclick = callback
        element.classList.add("clickable")
        if (color) element.style.color = color.string.hex
        return element
    }

    printCommand(commandText, command, color, endLine=true, opts) {
        let element = this.print(commandText, color, {forceElement: true, ...opts})
        element.onclick = this.makeInputFunc(command ?? commandText)
        element.classList.add("clickable")
        if (color) element.style.color = color.string.hex
        if (endLine) this.addLineBreak()
    }

    printEasterEgg(eggName, {endLine=true}={}) {
        if (!terminal.currInputElement)
            terminal.printEasterEggRaw(eggName, endLine)
        else {
            terminal.removeCurrInput()
            terminal.printEasterEggRaw(eggName, endLine)
            terminal.standardInputPrompt()
        }
    }

    printEasterEggRaw(eggName, endLine=true) {
        let displayName = ` ${eggName} `
        let element = this.print(displayName, undefined, {forceElement: true})
        element.onclick = () => {
            if (this.data.easterEggs.has(eggName)) {
                alert("You have already found this one. Enter 'easter-eggs' to see all found ones.")
            } else {
                this.data.addEasterEgg(eggName)
                alert("You found an easter egg! It's added to your basket. Enter 'easter-eggs' to see all found ones.")
            }
        }

        // style egg
        element.classList.add("easter-egg")

        if (endLine) this.addLineBreak()
    }

    printLink(msg, url, color, endLine=true) {
        let element = this.print(msg, color, {forceElement: true, element: "a"})
        element.href = url
        if (endLine) this.printLine()
    }

    async standardInputPrompt() {
        let element = this.print(this.fileSystem.pathStr + " ", undefined, {forceElement: true, addToCache: false})
        element.style.marginLeft = `-${this.charWidth * 3}px`
        this.correctIndicator = this.print("$ ", Color.LIGHT_GREEN, {addToCache: false})
        let text = await this.prompt("", {affectCorrectness: true})
        await this.input(text)
    }

    async input(text, testMode=false) {
        if (!testMode)
            this.log(`Inputted Text: "${text}"`)

        // clear interrupt signal
        this._interruptCallbackQueue = []
        this._interruptSignal = false

        if (this.mobileKeyboard) {
            this.mobileKeyboard.updateLayout(this.mobileKeyboard.Layout.CMD_RUNNING)
        }

        if (TerminalParser.isVariable(text)) {
            let varName = TerminalParser.extractVariableName(text + "=")
            if (this.variableCache[varName] == undefined) {
                this.printError(`Variable '${varName}' is not defined\n`)
            } else {
                let varValue = this.variableCache[varName]
                this.printLine(varValue)
            }
            this.standardInputPrompt()
            return
        }

        let assignmentInfo = TerminalParser.extractAssignment(text)
        if (assignmentInfo) {
            this.variableCache[assignmentInfo.name] = ""
            this.outputCacheVarName = assignmentInfo.name
            text = assignmentInfo.value
            this.outputChannel = OutputChannel.CACHE_AND_USER
        } else {
            this.outputChannel = OutputChannel.USER
        }

        let tokens = TerminalParser.tokenize(text)
        if (tokens.length == 0) {
            this.standardInputPrompt()
            return
        }

        let [commandText, args] = TerminalParser.extractCommandAndArgs(tokens)
        let rawArgs = text.slice(commandText.length)
        if (this.commandExists(commandText)) {
            let command = await this.getCommand(commandText)
            return await command.run(tokens, rawArgs, {callFinishFunc: !testMode, terminalObj: this})
        } else {
            let cmdnotfound = await this.getCommand("cmdnotfound")
            await cmdnotfound.run(["cmdnotfound", commandText, rawArgs], commandText, {
                callFinishFunc: !testMode,
                terminalObj: this,
                processArgs: false
            })
            return false
        }
    }

    get allCommands() {
        return Object.fromEntries(Object.entries(this.commandData).map(([cmd, data]) => {
            return [cmd, data["description"]]
        }))
    }

    commandExists(commandName) {
        return Object.keys(this.allCommands).includes(commandName)
    }

    addCommand(name, callback, info) {
        this.commandCache[name] = new Command(name, callback, info)
    }

    get functions() {
        return Object.entries(this.allCommands).map(d => {
            return {name: d[0], description: d[1]}
        })
    }

    get commandIsExecuting() {
        return this.expectingFinishCommand
    }

    get visibleFunctions() {
        return Object.entries(terminal.commandData)
            .filter(([c, d]) => !d.isSecret)
            .map(([c, d]) => {
                d.name = c
                return d
            })
    }

    get currDirectory() {
        return this.fileSystem.currDirectory
    }

    get lastPrintedChar() {
        return this.parentNode.textContent[this.parentNode.textContent.length - 1]
    }

    get rootDirectory() {
        return this.fileSystem.root
    }

    get prevCommands() {
        return this.data.history
    }

    get widthPx() {
        let computedStyle = getComputedStyle(this.parentNode)
        let elementWidth = this.parentNode.clientWidth
        elementWidth -= parseFloat(computedStyle.paddingLeft) + parseFloat(computedStyle.paddingRight)
        return elementWidth
    }

    get charWidth() {
        let firstSpan = this.parentNode.querySelector("span")
        let firstSpanWidth = firstSpan.getBoundingClientRect().width
        let textWidth = firstSpan.textContent.length
        return firstSpanWidth / textWidth
    }

    get approxWidthInChars() {
        return Math.floor(this.widthPx / this.charWidth) - 5
    }

    async _loadScript(url, extraData={}, {
        asyncMode=false
    }={}) {
        if (!asyncMode) {
            this.setLoading(url)
        }

        // make a new iframe to load the script in
        // to prevent the script from accessing the global scope
        // instead, it will access the iframe's global scope
        // in which i place the terminal object
        
        // this way, command scripts each have their own scope
        // and cannot access each other's variables
        // which is good because it prevents command scripts
        // from interfering with each other (name conflicts, etc.)

        let iframe = await new Promise(resolve => {
            let iframeElement = document.createElement("iframe")
            iframeElement.addEventListener("load", () => resolve(iframeElement))
            iframeElement.style.display = "none"
            document.body.appendChild(iframeElement)
        })

        // add variables to iframe namespace
        let iframeDocument = iframe.contentDocument || iframe.contentWindow.document
        iframe.contentWindow.terminal = this
        for (let key in extraData)
            iframe.contentWindow[key] = extraData[key]
        for (let key in UtilityFunctions)
            iframe.contentWindow[key] = UtilityFunctions[key]
        iframe.contentWindow["sleep"] = this.sleep
        iframe.contentWindow["audioContext"] = this.audioContext
        iframe.contentWindow["loadIndex"] = loadIndex

        await new Promise(resolve => {    
            let script = document.createElement("script")
            script.addEventListener("load", resolve)
            script.src = `${this.baseUrl}${url}?${loadIndex}`
            iframeDocument.body.appendChild(script)
        })

        this.log(`Loaded Script: ${url}`)

        if (!asyncMode) {
            this.unsetLoading()
        }

        return iframe.contentWindow
    }

    async loadCommand(name, {force=false}={}) {
        if (this.commandCache[name] && !force)
            return this.commandCache[name]
        let commandWindow = await this._loadScript(`js/commands/${name}.js`)
        this.commandCache[name].windowScope = commandWindow
        for (let terminalInstance of Object.values(ALL_TERMINALS)) {
            terminalInstance.commandCache[name] = this.commandCache[name]
        }
        return this.commandCache[name]
    }

    async getCommand(name) {
        if (!this.commandExists(name))
            throw new Error(`Command not found: ${name}`)
        if (!this.commandCache[name]) {
            return await this.loadCommand(name)
        } else {
            return this.commandCache[name]
        }
    }

    async finishCommand({force=false}={}) {
        if (this.outputChannel === OutputChannel.CACHE_AND_USER) {
            this.outputChannel = OutputChannel.USER
        }

        if ((!this.expectingFinishCommand && !force) || this.currInputElement)
            return
        this.expectingFinishCommand = false
        
        if (this.lastPrintedChar !== "\n")
            this.print("\n")
        this.print("\n")

        this._interruptCallbackQueue = []
        this._interruptSignal = false
        this.tempCommandInputHistory = []

        this.fileSystem.save()
        this.updatePath()

        this.standardInputPrompt()
    }

    getCurrDate() {
        return new Date().toLocaleDateString().replace(/\//g, "-")
    }

    getCurrTime() {
        return new Date().toLocaleTimeString()
    }

    addToLogBuffer(msg, type, time, date, template) {
        this.logBuffer.push({msg, type, time, date, template})
    }

    cleanLogBuffer() {
        while (this.logBuffer.length > 0) {
            let logData = this.logBuffer.shift()
            this.log(logData.msg, logData)
        }
    }

    log(msg, {type="info", time="auto", date="auto", timestamp="auto", template="[TYPE] [TIMESTAMP] MSG"}={}) {
        if (!this.hasInitted) {
            this.addToLogBuffer(msg, type, time, date, template)
            return
        }

        if (time === "auto")
            time = new Date().toLocaleTimeString()
        if (date === "auto")
            date = new Date().toLocaleDateString()
        if (timestamp === "auto")
            timestamp = Date.now() + ""
        let logText = template
            .replace("TIMESTAMP", timestamp)
            .replace("TYPE", type)
            .replace("TIME", time)
            .replace("DATE", date)
            .replace("MSG", msg)


        let lines = terminal.logFile.text.split("\n")
                    .filter(line => line.length > 0)
        while (lines.length > terminal.logFileMaxLines - 1) {
            lines.shift()
        }

        lines.push(logText)
        terminal.logFile.text = lines.join("\n")
    }

    get logFilePath() {
        return "root/" + this.logFileName
    }

    get logFile() {
        if (this.fileExists(this.logFilePath)) {
            return this.getFile(this.logFilePath)
        } else {
            let logFile = new PlainTextFile().setName(this.logFileName)
            this.rootDirectory.addChild(logFile)
            return logFile
        }
    }

    get logFileName() {
        return "latest.log"
    }

    reset() {
        this.data.resetAll()
        localStorage.removeItem("terminal-filesystem")
    }

    makeInputFunc(text) {
        return async () => {
            if (this.expectingFinishCommand) {
                return
            }

            if (this.currInputElement) {
                this.removeCurrInput()
            }

            this.expectingFinishCommand = true
            await this.animatePrint(text, 5)
            this.data.addToHistory(text)
            this.input(text)
        }
    }

    async init({
        runInput=true,
        runStartupCommands=true,
        loadPath=true,
        loadSidePanel=true,
        ignoreMobile=false
    }={}) {
        await this._loadScript(this.commandListURL)
        await this.fileSystem.load()

        if (this.isMobile && !ignoreMobile) {
            await this._loadScript(this.mobileKeyboardURL)
        }

        if (this.isUrlParamSet("404")) {
            let error404 = await this.getCommand("error404")
            error404.run()
        } else {
            if (runStartupCommands) {
                for (let startupCommand of this.data.startupCommands) {
                    await this.input(startupCommand, true)
                }
            }

            if (loadPath) {
                // load path from localstorage
                let filePath = FilePath.from(this.data.path)
                if (this.fileExists(filePath)) {
                    this.fileSystem.currDirectory = this.getFile(filePath)
                } else {
                    this.updatePath()
                }
            }

            if (!ignoreMobile) {
                if (this.isMobile) {
                    this.print("Mobile keyboard active. ")
                    this.printCommand("click to disable", "keyboard off")
                } else if (this.autoIsMobile) {
                    this.print("Mobile keyboard inactive. ")
                    this.printCommand("click to enable", "keyboard on")
                }
            }

            // TODO: make this into terminal.data option
            if (loadSidePanel) {
                this._loadScript(this.sidePanelURL, {}, {asyncMode: true})
            }

            this.expectingFinishCommand = true
            if (runInput) {
                this.finishCommand()
            }
        

        this.hasInitted = true
        this.cleanLogBuffer()
    }
}

    async initFrom(otherTerminal) {
        this.commandData = otherTerminal.commandData
        this.fileSystem.loadJSON(otherTerminal.fileSystem.toJSON()) 
        this.commandCache = otherTerminal.commandCache
        this.startTime = otherTerminal.startTime 
        this.hasInitted = true
        this.cleanLogBuffer()
    }

    get autoIsMobile() {
        return /Mobi/i.test(window.navigator.userAgent)
    }

    get isMobile() {
        if (terminal.data.mobile === true)
            return true
        if (terminal.data.mobile === false)
            return false
        return this.autoIsMobile
    }

    async clear(addPrompt=false) {
        let newPromptValue = ""
        if (this.currInputElement)
            newPromptValue = this.currInputElement.value

        this.removeCurrInput()
        this.parentNode.innerHTML = ""

        if (addPrompt) {
            this.standardInputPrompt()
            this.currInputElement.value = newPromptValue
        }
    }

    currFontSizeIndex = 6

    changeTextSize(increment) {
        const options = [3, 5, 7.5, 10, 12.5, 14, 15, 16, 17, 18, 19, 20, 22, 25, 30, 35, 40, 45, 50, 60, 80, 100]
        this.currFontSizeIndex = (this.currFontSizeIndex + increment) % options.length
        while (this.currFontSizeIndex < 0) this.currFontSizeIndex += options.length
        this.parentNode.style.setProperty("--font-size", `${options[this.currFontSizeIndex]}px`)
    }

    enlargeText() {
        this.changeTextSize(1)
    }

    shrinkText() {
        this.changeTextSize(-1)
    }

    _onkeydownShortcut(event) {
        let key = event.key

        let shortcut = this.keyboardShortcuts.find(shortcut => {
            if (shortcut.key.toLowerCase() != key.toLowerCase())
                return false
            if (shortcut.ctrl !== undefined && shortcut.ctrl !== event.ctrlKey)
                return false
            if (shortcut.alt !== undefined && shortcut.alt !== event.altKey)
                return false
            if (shortcut.shift !== undefined && shortcut.shift !== event.shiftKey)
                return false
            return true
        })

        if (shortcut) {
            event.preventDefault()
            shortcut.run(event)
        }
    }

    static makeRandomId(length) {
        let result = ""
        let characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length))
        }
        return result
    }

    constructor(terminalName="none", {
        parentNode=undefined,
        baseUrl=undefined,
        guiMode=false
    }={}) {
        if (parentNode) {
            this.parentNode = parentNode
        }

        this.guiMode = guiMode
        this.baseUrl = baseUrl || ""

        this.startTime = Date.now()

        this.name = terminalName

        this.sessionId = `${this.getCurrDate()}-${this.getCurrTime()}`
        this.hasInitted = false
        this.logBuffer = []
        this.logFileMaxLines = 100
        
        addEventListener("keydown", this._onkeydownShortcut.bind(this))

        // when the user clicks on the terminal, focus the input element
        this.parentNode.addEventListener("click", () => {
            function getSelectedText() {
                let text = ""
                if (typeof window.getSelection != "undefined") {
                    text = window.getSelection().toString()
                } else if (typeof document.selection != "undefined" && document.selection.type == "Text") {
                    text = document.selection.createRange().text
                }
                return text
            }

            // if the user has selected text, don't focus the input element
            if (this.currInputElement && !getSelectedText())
                this.focusInput()
        })

        // save the keys pressed by the user
        // so that they can be used in the keydown event listener
        // to detect key combinations
        this.pressed = {}

        document.addEventListener("keydown", event => {
            this.pressed[event.key] = true
        })

        document.addEventListener("keyup", event => {
            this.pressed[event.key] = false
        })

        this.body = document.body
        this.document = document
        this.window = window

        this._interruptSignal = false
        this._interruptCallbackQueue = []

        ALL_TERMINALS[terminalName] = this

        if (terminalName === "main") {
            this.log("new terminal initialized", {type: "startup"})
            this.log(`> hostname: ${this.window.location.href}`, {type: "startup"})
            this.log(`> timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`, {type: "startup"})
        }
    }

}
