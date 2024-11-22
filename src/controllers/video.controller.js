import mongoose, { isValidObjectId } from "mongoose"
import { Video } from "../models/video.model.js"
import { User } from "../models/user.model.js"
import { ApiError } from "../utils/apiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { uploadOnCloudinary, deleteFromCloudinary } from "../utils/cloudinary.js"


const getAllVideos = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, query, sortBy, sortType, userId } = req.query
    //TODO: get all videos based on query, sort, pagination
    const video = await Video.aggregate(
        [
            {
                $match: {
                    $or: [
                        { title: { $regex: query, $options: "i" } }, // Search in title
                        { description: { $regex: query, $options: "i" } } // Search in description
                    ]
                }
            },
            {
                $lookup: {
                    from: "users",
                    localField: "owner",
                    foreignField: "_id",
                    as: "createdBy"
                }
            },
            {
                $unwind: "$createdBy",
            },
            {
                $project: {
                    thumbnail: 1,
                    videoFile: 1,
                    title: 1,
                    description: 1,
                    createdBy: {
                        fullName: 1,
                        username: 1,
                        avatar: 1,
                    },
                },
            },
            {
                $sort: {
                    [sortBy]: sortType === "asc" ? 1 : -1
                }
            },
            {
                $skip: (page - 1) * limit,
            },
            {
                $limit: parseInt(limit),
            }
        ]
    );
    return res
        .status(200)
        .json(new ApiResponse(200, videos, "Fetched all videos"))

})

const publishAVideo = asyncHandler(async (req, res) => {
    const { title, description } = req.body
    // TODO: get video, upload to cloudinary, create video
    if (!title && !description) {
        throw new ApiError(400, "All fields are required")
    }
    const videoFileLocalPath = req.files?.videoFile[0]?.path;

    if (!videoFileLocalPath) {
        throw new ApiError(400, "No video file found")
    }
    const videoFile = await uploadOnCloudinary(videoFileLocalPath)
    if (!videoFile.url) {
        throw new ApiError(500, "Error while uploading video file")
    }
    const thumbnailLocalPath = req.files?.thumbnail[0]?.path;
    if (!thumbnailLocalPath) {
        throw new ApiError(400, "No thumbnail file found")
    }
    const thumbnail = await uploadOnCloudinary(thumbnailLocalPath)
    if (!thumbnail.url) {
        throw new ApiError(500, "Error while uploading thumbnail")
    }

    const video = await Video.create({
        title,
        description,
        videoFile: videoFile.url,
        thumbnail: thumbnail.url,
        duration: videoFile.duration,
        owner: req.user._id
    });
    if (!video) {
        throw new ApiError(500, "Error while publishing hte video")
    }
    return res
        .status(200)
        .json(new ApiResponse(200, video, "Video file published"))

})

const getVideoById = asyncHandler(async (req, res) => {
    const { videoId } = req.params
    //TODO: get video by id
    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid video id")
    }
    const video = await Video.findById(videoId)

    if (!video) {
        throw new ApiError(404, "No video found")
    }
    return res
        .status(200)
        .json(new ApiResponse(200, video, "Video fetched"))
})

const updateVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params
    //TODO: update video details like title, description, thumbnail
    const { title, description } = req.body;
    const newThumbnailLocalPath = req.file?.path;

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid Video ID");
    }
    const video = await Video.findById(videoId)
    if (!video) {
        throw new ApiError(404, "Video not found")
    }
    if (video.owner.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You are not allowed to update this video")
    }
    if (!title || !description) {
        throw new ApiError(400, "Provide updated title and description")
    }

    if (!newThumbnailLocalPath) {
        throw new ApiError(400, "Provide Thumbnail File")
    }
    const deleteThumbnail = await deleteFromCloudinary(video.thumbnail)
    if (deleteThumbnail.result !== "ok") {
        throw new ApiError(500, "Error while deleting old thumbnail from cloudinary")
    }
    const newThumbnail = await uploadOnCloudinary(newThumbnailLocalPath);
    if (!newThumbnail.url) {
        throw new ApiError(500, "Error while uploading new thumbnail")
    }
    const updateVideo = await Video.findByIdAndUpdate(
        videoId,
        {
            $set: {
                title,
                description,
                thumbnail: newThumbnail.url,
            }
        },
        {
            new: true
        }
    )
    return res
        .status(200)
        .json(new ApiResponse(200, updateVideo, "Video details updated"))

})

const deleteVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    // Validate video ID
    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid Video ID");
    }

    // Find the video
    const video = await Video.findById(videoId);
    if (!video) {
        throw new ApiError(404, "Video not found");
    }

    // Check ownership
    if (video.owner.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You are not allowed to delete this video");
    }

    // Delete files from Cloudinary in parallel
    const [deleteVideoFile, deleteThumbnail] = await Promise.all([
        deleteFromCloudinary(video.videoFile),
        deleteFromCloudinary(video.thumbnail),
    ]);

    if (deleteVideoFile.result !== "ok" || deleteThumbnail.result !== "ok") {
        throw new ApiError(500, "Error while deleting files from Cloudinary");
    }

    // Delete video record from database
    await Video.findByIdAndDelete(videoId);

    // Respond with success
    return res
        .status(200)
        .json(new ApiResponse(200, {}, "Video deleted successfully"));
});


const togglePublishStatus = asyncHandler(async (req, res) => {
    const { videoId } = req.params
    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid Video ID");
    }
    const video = await Video.findById(videoId);
    if (!video) {
        throw new ApiError(404, "Video not found");
    }

    // Check ownership
    if (video.owner.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You are not allowed to delete this video");
    }
    const modifyVideoPublishStatus = await Video.findByIdAndUpdate(videoId,
        {
            $set: {
                isPublished: !video.isPublished,
            }
        },
        {
            new: true,
        },
    );
    return res
        .status(200)
        .json(new ApiResponse(200, modifyVideoPublishStatus, "Video publish status modified"))
})

export {
    getAllVideos,
    publishAVideo,
    getVideoById,
    updateVideo,
    deleteVideo,
    togglePublishStatus
}