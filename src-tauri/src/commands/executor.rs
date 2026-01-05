use crate::error::AppError;
use log::debug;
use std::process::Stdio;
use tokio::{io::AsyncWriteExt, process::Command};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Execute JavaScript code.
#[tauri::command]
pub async fn execute_javascript(
    code: String,
    data: String,
    node_path: Option<String>,
    deno_path: Option<String>,
) -> Result<String, AppError> {
    // create JavaScript code wrapper
    let wrapped_code = format!(
        r#"
const data = {};
{}
const result = process(data);
console.log(typeof result === 'string' ? result : JSON.stringify(result));
        "#,
        data, code
    );

    // if custom path is provided, use it directly
    if let Some(program) = node_path.filter(|p| !p.trim().is_empty()) {
        return execute_javascript_custom(program.trim(), &wrapped_code, "node").await;
    } else if let Some(program) = deno_path.filter(|p| !p.trim().is_empty()) {
        return execute_javascript_custom(program.trim(), &wrapped_code, "deno").await;
    };

    // use system path to execute
    execute_javascript_system(&wrapped_code).await
}

/// Execute JavaScript code with custom path.
async fn execute_javascript_custom(
    program: &str,
    code: &str,
    runtime: &str,
) -> Result<String, AppError> {
    debug!("Executing JavaScript with custom program: {}", program);

    // check if it's deno runtime
    let deno = runtime == "deno";

    // on Windows, special handling is needed for .bat files
    #[cfg(target_os = "windows")]
    let use_stdin = program.to_lowercase().ends_with(".bat");
    #[cfg(not(target_os = "windows"))]
    let use_stdin = false;

    let mut command = if use_stdin {
        // for .bat files, pass code through stdin to avoid parameter escaping issues
        let mut cmd = Command::new(program);
        if deno {
            cmd.arg("run").arg("-"); // use - to read from stdin
        }
        cmd.stdin(Stdio::piped());
        cmd
    } else {
        // for regular executables, use -e parameter
        let mut cmd = Command::new(program);
        if deno {
            cmd.arg("eval");
        } else {
            cmd.arg("-e");
        }
        cmd.arg(code);
        cmd
    };
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    // hide console window on Windows
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    match command.spawn() {
        Ok(mut child) => {
            // if using stdin, write code
            if use_stdin {
                if let Some(mut stdin) = child.stdin.take() {
                    stdin.write_all(code.as_bytes()).await?;
                    drop(stdin); // close stdin
                }
            }

            let output = child.wait_with_output().await?;
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                Ok(stdout.trim().to_string())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!("JavaScript execution failed:\n\n{}", stderr).into())
            }
        }
        Err(e) => Err(format!("Failed to execute the program at '{}': {}", program, e).into()),
    }
}

/// Execute JavaScript code with system path.
async fn execute_javascript_system(code: &str) -> Result<String, AppError> {
    debug!("Executing JavaScript with system path");

    // get user home directory
    #[cfg(target_os = "windows")]
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    #[cfg(not(target_os = "windows"))]
    let home = std::env::var("HOME").unwrap_or_default();

    // common JavaScript runtime paths
    #[cfg(target_os = "windows")]
    let paths: Vec<String> = {
        vec![
            "C:\\Program Files\\nodejs".to_string(),
            "C:\\Program Files (x86)\\nodejs".to_string(),
            format!("{}\\AppData\\Local\\Programs\\nodejs", home),
            format!("{}\\AppData\\Roaming\\npm", home),
            format!("{}\\.deno\\bin", home),
        ]
    };
    #[cfg(not(target_os = "windows"))]
    let paths: Vec<String> = {
        vec![
            "/usr/local/bin".to_string(),
            "/opt/homebrew/bin".to_string(),
            "/opt/local/bin".to_string(),
            "/usr/bin".to_string(),
            "/bin".to_string(),
            format!("{}/.local/bin", home),
            format!("{}/.deno/bin", home),
        ]
    };

    // build PATH environment variable
    #[cfg(target_os = "windows")]
    let separator = ";";
    #[cfg(not(target_os = "windows"))]
    let separator = ":";

    let path = match std::env::var("PATH") {
        Ok(path) if !path.is_empty() => format!("{}{}{}", path, separator, paths.join(separator)),
        _ => paths.join(separator),
    };

    // try to use node first, if failed then try deno
    let commands = [("node", vec!["-e"]), ("deno", vec!["eval"])];
    for (cmd, args) in &commands {
        let mut command = Command::new(cmd);
        for arg in args {
            command.arg(arg);
        }
        command
            .arg(code)
            .env("PATH", &path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // hide console window on Windows
        #[cfg(target_os = "windows")]
        command.creation_flags(CREATE_NO_WINDOW);

        match command.spawn() {
            Ok(child) => {
                let output = child.wait_with_output().await?;
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    return Ok(stdout.trim().to_string());
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    // if it's a command not found error, try the next command
                    if stderr.contains("No such file or directory")
                        || stderr.contains("command not found")
                    {
                        continue;
                    }
                    return Err(format!("JavaScript execution failed:\n\n{}", stderr).into());
                }
            }
            Err(_) => continue, // try next command
        }
    }

    Err("JavaScript runtime not found. Please install Node.js or Deno.".into())
}

/// Execute Python code.
#[tauri::command]
pub async fn execute_python(
    code: String,
    data: String,
    python_path: Option<String>,
) -> Result<String, AppError> {
    // create Python code wrapper
    let wrapped_code = format!(
        r#"
import json
data = {}
{}
result = process(data)
print(result if isinstance(result, str) else json.dumps(result, ensure_ascii=False))
        "#,
        data, code
    );

    // if custom path is provided, use it directly
    if let Some(program) = python_path.filter(|p| !p.trim().is_empty()) {
        return execute_python_custom(program.trim(), &wrapped_code).await;
    }

    // use system path to execute
    execute_python_system(&wrapped_code).await
}

/// Execute Python code with custom path.
async fn execute_python_custom(program: &str, code: &str) -> Result<String, AppError> {
    debug!("Executing Python with custom program: {}", program);

    // on Windows, special handling is needed for .bat files
    #[cfg(target_os = "windows")]
    let use_stdin = program.to_lowercase().ends_with(".bat");
    #[cfg(not(target_os = "windows"))]
    let use_stdin = false;

    let mut command = if use_stdin {
        // for .bat files, pass code through stdin to avoid parameter escaping issues
        let mut cmd = Command::new(program);
        cmd.stdin(Stdio::piped());
        cmd
    } else {
        // for regular executables, use -c parameter
        let mut cmd = Command::new(program);
        cmd.arg("-c").arg(code);
        cmd
    };
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    // hide console window on Windows
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    // set UTF-8 encoding for Python on Windows
    #[cfg(target_os = "windows")]
    command.env("PYTHONIOENCODING", "utf-8");

    match command.spawn() {
        Ok(mut child) => {
            // if using stdin, write code
            if use_stdin {
                if let Some(mut stdin) = child.stdin.take() {
                    stdin.write_all(code.as_bytes()).await?;
                    drop(stdin); // close stdin
                }
            }

            let output = child.wait_with_output().await?;
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                Ok(stdout.trim().to_string())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!("Python execution failed:\n\n{}", stderr).into())
            }
        }
        Err(e) => Err(format!("Failed to execute the program at '{}': {}", program, e).into()),
    }
}

/// Execute Python code with system path.
async fn execute_python_system(code: &str) -> Result<String, AppError> {
    debug!("Executing Python with system path");

    // get user home directory
    #[cfg(target_os = "windows")]
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    #[cfg(not(target_os = "windows"))]
    let home = std::env::var("HOME").unwrap_or_default();

    // common Python runtime paths
    #[cfg(target_os = "windows")]
    let paths: Vec<String> = {
        // add all common Python versions and their Scripts directories
        let mut paths = vec![format!("{}\\AppData\\Local\\Microsoft\\WindowsApps", home)];
        let versions = [
            "Python314",
            "Python313",
            "Python312",
            "Python311",
            "Python310",
            "Python39",
        ];
        for version in versions {
            paths.push(format!(
                "{}\\AppData\\Local\\Programs\\Python\\{}",
                home, version
            ));
            paths.push(format!(
                "{}\\AppData\\Local\\Programs\\Python\\{}\\Scripts",
                home, version
            ));
            paths.push(format!("C:\\{}", version));
            paths.push(format!("C:\\{}\\Scripts", version));
        }
        paths
    };
    #[cfg(not(target_os = "windows"))]
    let paths: Vec<String> = {
        vec![
            format!("{}/.pyenv/shims", home),
            "/usr/local/bin".to_string(),
            "/opt/homebrew/bin".to_string(),
            "/opt/local/bin".to_string(),
            "/usr/bin".to_string(),
            "/bin".to_string(),
            format!("{}/.local/bin", home),
        ]
    };

    // build PATH environment variable
    #[cfg(target_os = "windows")]
    let separator = ";";
    #[cfg(not(target_os = "windows"))]
    let separator = ":";

    let path = match std::env::var("PATH") {
        Ok(path) if !path.is_empty() => format!("{}{}{}", path, separator, paths.join(separator)),
        _ => paths.join(separator),
    };

    // try to use python3 first, if failed then try python
    let commands = ["python3", "python"];
    for cmd in &commands {
        let mut command = Command::new(cmd);
        command
            .arg("-c")
            .arg(code)
            .env("PATH", &path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // hide console window on Windows
        #[cfg(target_os = "windows")]
        command.creation_flags(CREATE_NO_WINDOW);

        // set UTF-8 encoding for Python on Windows
        #[cfg(target_os = "windows")]
        command.env("PYTHONIOENCODING", "utf-8");

        match command.spawn() {
            Ok(child) => {
                let output = child.wait_with_output().await?;
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    return Ok(stdout.trim().to_string());
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    // if it's a command not found error, try the next command
                    if stderr.contains("No such file or directory")
                        || stderr.contains("command not found")
                    {
                        continue;
                    }
                    return Err(format!("Python execution failed:\n\n{}", stderr).into());
                }
            }
            Err(_) => continue, // try next command
        }
    }

    Err("Python interpreter not found. Please install Python.".into())
}
