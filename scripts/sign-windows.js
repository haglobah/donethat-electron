exports.default = async function(configuration) {
    // do not include passwords or other sensitive data in the file
    // rather create environment variables with sensitive data
    const CERTIFICATE_NAME = process.env.WINDOWS_SIGN_CERTIFICATE_NAME;
    const TOKEN_PASSWORD = process.env.WINDOWS_SIGN_TOKEN_PASSWORD;
  
    require("child_process").execSync(
      // your commande here ! For exemple and with JSign :
      `java -jar tools/jsign-2.1.jar --keystore hardwareToken.cfg --storepass "${TOKEN_PASSWORD}" --storetype PKCS11 --tsaurl http://timestamp.digicert.com --alias "${CERTIFICATE_NAME}" "${configuration.path}"`,
      {
        stdio: "inherit"
      }
    );
  };