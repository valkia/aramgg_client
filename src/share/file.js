const fs = window.fs.promises;
const fse = window.fse;

export const saveToFile = async (desDir, data) => {
  try {
    const file = `${desDir}/Game/Config/Champions/${data.champion}/Recommended/${data.fileName}.json`;
    await fse.outputFile(file, JSON.stringify(data, null, 4));
    return true;
  } catch (error) {
    return error;
  }
};

export const removeFolderContent = async (dir) => {
  try {
    await fse.emptyDir(dir);
    return true;
  } catch (error) {
    return error;
  }
};

export const getLcuToken = async (dirPath) => {
  const dir = `${dirPath}/LeagueClient`

  try {
    console.log(`[getLcuToken] Reading from: ${dir}`)
    const files = await fs.readdir(dir)

    // 查找 LeagueClient.log 文件（不是 renderer.log）
    const logFiles = files
      .filter((f) => f.includes('LeagueClientUx.log') && !f.includes('-tracing'))
      .sort((a, b) => {
        // 按文件名（包含时间戳）排序，最新的在最后
        return a.localeCompare(b)
      })

    const latest = logFiles.pop() // 获取最新的日志文件

    if (!latest) {
      console.error(`[getLcuToken] ❌ No LeagueClient.log found`)
      console.log(`[getLcuToken] Available files:`, files.slice(0, 5))
      return [null, null, null]
    }

    console.log(`[getLcuToken] Reading file: ${latest}`)
    const filePath = `${dir}/${latest}`
    const content = await fs.readFile(filePath, 'utf8')
    console.log(`[getLcuToken] File size: ${content.length} bytes`)

    // 查找 LCU 连接信息
    // 格式: https://riot:TOKEN@127.0.0.1:PORT/
    const urlMatch = content.match(/https:\/\/riot:([^@]+)@127\.0\.0\.1:(\d+)/)

    if (!urlMatch) {
      console.error(`[getLcuToken] ❌ LCU URL pattern not found in log`)
      console.log(`[getLcuToken] Trying alternative pattern...`)

      // 尝试旧格式
      const altMatch = content.match(/https(.*)\/index\.html/)
      if (altMatch) {
        const url = altMatch[1]
        const tokenMatch = url.match(/riot:(.*)@/)
        const portMatch = url.match(/:(\d+)/)

        if (tokenMatch && portMatch) {
          const token = tokenMatch[1]
          const port = portMatch[1]
          const urlWithAuth = `https${url}`

          console.log(`[getLcuToken] ✅ Successfully extracted (alt pattern):`)
          console.log(`  Token: ${token.substring(0, 10)}...`)
          console.log(`  Port: ${port}`)
          console.log(`  URL: ${urlWithAuth}`)

          return [token, port, urlWithAuth]
        }
      }

      console.error(`[getLcuToken] ❌ No valid pattern found`)
      return [null, null, null]
    }

    const token = urlMatch[1]
    const port = urlMatch[2]
    const urlWithAuth = `https://riot:${token}@127.0.0.1:${port}`

    console.log(`[getLcuToken] ✅ Successfully extracted:`)
    console.log(`  Token: ${token.substring(0, 10)}...`)
    console.log(`  Port: ${port}`)
    console.log(`  URL: ${urlWithAuth}`)

    return [token, port, urlWithAuth]
  } catch (err) {
    console.error(`[getLcuToken] ❌ Error:`, err.message)
    console.error(`  Stack:`, err.stack)
    return [null, null, null]
  }
};
