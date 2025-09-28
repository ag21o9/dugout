# Image Upload Guide

This document explains how to use the image upload functionality for users, players, teams, and tournaments.

## API Endpoints with Image Upload

### 1. User Profile Picture Upload

#### Create User with Profile Picture
- **POST** `/users`
- **Content-Type**: `multipart/form-data`
- **Fields**:
  - `name` (required): User's name
  - `email` (required): User's email
  - `phone` (optional): Phone number
  - `dob` (optional): Date of birth (ISO string)
  - `gender` (optional): MALE | FEMALE | OTHER
  - `profilepic` (optional): Image file

#### Update User Profile Picture
- **PATCH** `/users/:userId`
- **Content-Type**: `multipart/form-data`
- **Fields**: Same as create, all optional except new profile picture file

#### Combined User + Player Registration with Images
- **POST** `/users/register-with-player`
- **Content-Type**: `multipart/form-data`
- **Fields**:
  - All user fields (name, email, phone, dob, gender)
  - All player fields (battingStyle, bowlingStyle, state, district, subDistrict, village, pincode, playingRole)
  - `userProfilepic` (optional): Image file for user profile
  - `playerProfilepic` (optional): Image file for player profile

### 2. Player Profile Picture Upload

#### Create Player with Profile Picture
- **POST** `/players`
- **Content-Type**: `multipart/form-data`
- **Headers**: `Authorization: Bearer <token>`
- **Fields**:
  - `battingStyle` (optional): Batting style
  - `bowlingStyle` (optional): Bowling style
  - `state`, `district`, `subDistrict`, `village`, `pincode` (optional): Location fields
  - `playingRole` (optional): Player's role
  - `profilepic` (optional): Image file

### 3. Team Logo Upload

#### Create Team with Logo
- **POST** `/teams`
- **Content-Type**: `multipart/form-data`
- **Headers**: `Authorization: Bearer <token>`
- **Fields**:
  - `name` (required): Team name
  - `logoUrl` (optional): URL string if not uploading file
  - `logo` (optional): Image file

#### Update Team Logo
- **PATCH** `/teams/:teamId`
- **Content-Type**: `multipart/form-data`
- **Headers**: `Authorization: Bearer <token>`
- **Fields**:
  - `name` (optional): Updated team name
  - `logoUrl` (optional): URL string if not uploading file
  - `logo` (optional): New image file

### 4. Tournament Logo and Banner Upload

#### Create Tournament with Images
- **POST** `/tournaments`
- **Content-Type**: `multipart/form-data`
- **Headers**: `Authorization: Bearer <token>`
- **Fields**:
  - `name` (required): Tournament name
  - `ballType` (required): TENNIS | LEATHER | OTHER
  - `pitchType` (required): CEMENT | ROUGH | TURF | ASTROTURF | MATTING
  - `maxTeams` (required): Number of max teams
  - Other optional fields: `city`, `ground`, `contact`, `startDate`, `endDate`, `category`, `prize`, `prizeType`, `matchType`
  - `logoUrl` (optional): URL string if not uploading file
  - `bannerUrl` (optional): URL string if not uploading file
  - `logo` (optional): Image file for tournament logo
  - `banner` (optional): Image file for tournament banner

## Example Usage with JavaScript Fetch

### Creating User with Profile Picture
```javascript
const formData = new FormData();
formData.append('name', 'John Doe');
formData.append('email', 'john@example.com');
formData.append('phone', '+1234567890');
formData.append('profilepic', imageFile); // File object from input

const response = await fetch('/api/users', {
  method: 'POST',
  body: formData
});
```

### Creating Team with Logo
```javascript
const formData = new FormData();
formData.append('name', 'Team Warriors');
formData.append('logo', logoFile); // File object

const response = await fetch('/api/teams', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});
```

### Combined Registration with Multiple Images
```javascript
const formData = new FormData();
formData.append('name', 'John Doe');
formData.append('email', 'john@example.com');
formData.append('battingStyle', 'Right-hand');
formData.append('userProfilepic', userImage); // File object
formData.append('playerProfilepic', playerImage); // File object

const response = await fetch('/api/users/register-with-player', {
  method: 'POST',
  body: formData
});
```

### Creating Tournament with Logo and Banner
```javascript
const formData = new FormData();
formData.append('name', 'Summer Championship');
formData.append('ballType', 'TENNIS');
formData.append('pitchType', 'CEMENT');
formData.append('maxTeams', '16');
formData.append('logo', logoFile); // File object
formData.append('banner', bannerFile); // File object

const response = await fetch('/api/tournaments', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});
```

## Important Notes

1. **File Formats**: The system accepts common image formats (JPEG, PNG, GIF, etc.)
2. **File Size**: No explicit limit set, but Cloudinary has default limits
3. **Error Handling**: Failed uploads return 500 status with error message
4. **URLs**: Successfully uploaded images return Cloudinary URLs
5. **Fallback**: You can still provide `logoUrl`, `bannerUrl` as strings if not uploading files
6. **Authentication**: Team and tournament endpoints require valid JWT token
7. **Mixed Content**: You can combine file uploads with regular form fields in the same request

## Response Format

All endpoints return the uploaded image URLs in their response data:

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Entity Name",
    "profilepic": "https://res.cloudinary.com/...",
    "logoUrl": "https://res.cloudinary.com/...",
    "bannerUrl": "https://res.cloudinary.com/..."
  }
}
```