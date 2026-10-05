// A JSON file without its whitespace (minecraft-data's are indented: a third of their size)
module.exports = source => JSON.stringify(JSON.parse(source))
