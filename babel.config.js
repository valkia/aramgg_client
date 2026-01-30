module.exports = {
    presets: [
        ['@babel/preset-env', {targets: {node: 'current'}}]
    ],
    plugins: [
        [
            "component",
            {
                "libraryName": "element-plus",
                "styleLibraryName": "theme-chalk"
            }
        ]
    ]
}
