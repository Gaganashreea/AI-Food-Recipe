import { useState, useRef } from "react";
import { useRecipe } from "../context/RecipeContext";

function ImageUploader() {
  const [preview, setPreview] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const { analyzeImage, loading } = useRecipe();

  const handleFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Please upload an image file");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(file);

    analyzeImage(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = () => setDragActive(false);

  const handleInputChange = (e) => {
    handleFile(e.target.files[0]);
  };

  const handleClick = () => fileInputRef.current?.click();

  const handleCameraClick = () => cameraInputRef.current?.click();

  return (
    <div className="image-uploader">
      <h2>Upload a Photo</h2>

      <p className="uploader-subtitle">
        Take a photo of the ingredients in your fridge to discover recipes
      </p>

      <div
        className={`drop-zone${dragActive ? " drag-active" : ""}${preview ? " has-preview" : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {preview ? (
          <img
            src={preview}
            alt="Uploaded food"
            className="preview-image"
          />
        ) : (
          <div className="drop-zone-content">
            <span className="upload-icon"></span>
            <p>Drag & drop photo here </p>
            <p> OR </p>
            <p className="or-text">Choose an option below</p>
          </div>
        )}

        {/* Existing upload input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleInputChange}
          className="file-input"
        />

        {/* Camera input */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleInputChange}
          className="file-input"
        />
      </div>

      {!preview && (
        <div
          className="photo-options"
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "14px",
            marginTop: "18px",
          }}
        >
          <button
            type="button"
            className="photo-option-btn"
            onClick={handleCameraClick}
            style={{
              padding: "11px 20px",
              border: "1px solid #444",
              borderRadius: "10px",
              background: "#252525",
              color: "#fff",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "14px",
              fontWeight: "500",
              minWidth: "145px",
            }}
          >
            📷 Take Photo
          </button>

          <button
            type="button"
            className="photo-option-btn"
            onClick={handleClick}
            style={{
              padding: "11px 20px",
              border: "1px solid #444",
              borderRadius: "10px",
              background: "#252525",
              color: "#fff",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "14px",
              fontWeight: "500",
              minWidth: "145px",
            }}
          >
            🖼️ Upload Photo
          </button>
        </div>
      )}

      {loading && (
        <div className="analyzing-indicator">
          <div className="spinner"></div>
          <p>Analyzing your image with AI...</p>
        </div>
      )}
    </div>
  );
}

export default ImageUploader;